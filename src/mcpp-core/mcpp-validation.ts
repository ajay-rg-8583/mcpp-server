import type { 
    Tool, 
    DataUsage, 
    McppUsageContext, 
    McppServerConfig, 
    ConsentCheckResult, 
    ConsentRequest 
} from './mcpp-types.js';
import { MCPP_ERRORS } from './mcpp-errors.js';

/**
 * Validates data usage permissions based on hierarchy
 * Hierarchy: display < process < store < transfer
 */
export function validateDataUsage(required: DataUsage, granted: DataUsage): boolean {
    const hierarchy: DataUsage[] = ['display', 'process', 'store', 'transfer'];
    const requiredLevel = hierarchy.indexOf(required);
    const grantedLevel = hierarchy.indexOf(granted);
    
    return grantedLevel >= requiredLevel; // Higher level grants lower level access
}

/**
 * Gets the effective data usage permission for a tool
 */
export function getEffectiveDataUsagePermission(
    tool: Tool | undefined,
    dataUsage: DataUsage,
    serverConfig: McppServerConfig
): 'allow' | 'deny' | 'prompt' {
    // Check tool-specific permissions first
    if (tool?.dataPolicy?.data_usage_permissions?.[dataUsage]) {
        return tool.dataPolicy.data_usage_permissions[dataUsage]!;
    }
    
    // Fall back to server global policy
    return serverConfig.global_policies.default_data_usage_policy[dataUsage];
}

/**
 * Validates target permissions using unified access controls
 */
export function validateTargetPermissions(
    tool: Tool | undefined,
    usageContext: McppUsageContext,
    serverConfig: McppServerConfig
): { allowed: boolean; reason: string } {
    const { target } = usageContext;
    const destination = target.destination as string;
    
    // Check tool-specific target permissions
    if (tool?.dataPolicy?.target_permissions && destination) {
        const policy = tool.dataPolicy.target_permissions;
        
        // First check unified target controls (preferred approach)
        if (policy.blocked_targets?.includes(destination)) {
            return { allowed: false, reason: `${target.type}_blocked_by_tool` };
        }
        
        if (policy.allowed_targets) {
            if (Array.isArray(policy.allowed_targets)) {
                if (!policy.allowed_targets.includes(destination)) {
                    return { allowed: false, reason: `${target.type}_not_in_allowlist` };
                }
            } else if (policy.allowed_targets === 'none') {
                return { allowed: false, reason: 'no_targets_allowed' };
            }
        }
        
        // Fallback to legacy type-specific controls for backward compatibility
        if (target.type === 'server') {
            if (policy.blocked_servers?.includes(destination)) {
                return { allowed: false, reason: 'server_blocked_by_tool' };
            }
            
            if (policy.allowed_servers) {
                if (Array.isArray(policy.allowed_servers)) {
                    if (!policy.allowed_servers.includes(destination)) {
                        return { allowed: false, reason: 'server_not_in_allowlist' };
                    }
                } else if (policy.allowed_servers === 'none') {
                    return { allowed: false, reason: 'no_servers_allowed' };
                }
            }
        }
        
        if (target.type === 'client') {
            if (policy.allowed_clients) {
                if (Array.isArray(policy.allowed_clients)) {
                    if (!policy.allowed_clients.includes(destination)) {
                        return { allowed: false, reason: 'client_not_in_allowlist' };
                    }
                } else if (policy.allowed_clients === 'none') {
                    return { allowed: false, reason: 'no_clients_allowed' };
                }
            }
        }
    }
    
    // Check server global target policy
    const globalPolicy = serverConfig.global_policies.default_target_policy;
    
    if (target.type === 'server') {
        const serverPolicy = globalPolicy.server;
        if (Array.isArray(serverPolicy) && typeof target.destination === 'string') {
            if (!serverPolicy.includes(target.destination)) {
                return { allowed: false, reason: 'server_not_in_global_allowlist' };
            }
        } else if (serverPolicy === 'none') {
            return { allowed: false, reason: 'no_servers_allowed_globally' };
        }
    }
    
    if (target.type === 'llm') {
        const llmPolicy = globalPolicy.llm;
        if (llmPolicy === 'deny') {
            return { allowed: false, reason: 'llms_denied_globally' };
        }
    }
    
    return { allowed: true, reason: 'validation_passed' };
}

/**
 * Checks if user consent is required for the operation using unified target approach
 */
export function checkConsentRequired(
    tool: Tool | undefined,
    usageContext: McppUsageContext,
    serverConfig: McppServerConfig
): ConsentCheckResult {
    const { target, data_usage } = usageContext;
    const { user_consent_settings, target_categories } = serverConfig.global_policies;
    const destination = target.destination as string;
    
    // Skip consent for display operations to clients
    if (data_usage === 'display' && target.type === 'client') {
        return { consent_required: false, reason: ['display_to_client'], trusted_server: true };
    }
    
    // Check tool-specific consent overrides
    if (tool?.dataPolicy?.consent_overrides) {
        const overrides = tool.dataPolicy.consent_overrides;
        
        if (overrides.never_require_consent) {
            return { consent_required: false, reason: ['tool_override_never'], trusted_server: true };
        }
        
        if (overrides.always_require_consent) {
            return {
                consent_required: true,
                reason: ['tool_override_always'],
                trusted_server: false,
                custom_message: overrides.custom_consent_message
            };
        }
        
        // Check if destination is in tool's allowed list
        if (overrides.allowed_without_consent && 
            destination &&
            overrides.allowed_without_consent.includes(destination)) {
            return { consent_required: false, reason: ['tool_allowed_list'], trusted_server: true };
        }
    }
    
    // Unified target checking approach
    if (destination) {
        // Check if target is in trusted list
        if (user_consent_settings.trusted_targets?.includes(destination)) {
            return { consent_required: false, reason: ['trusted_target'], trusted_server: true };
        }
        
        // Check trusted domains (for servers mainly)
        for (const domain of user_consent_settings.trusted_domains) {
            if (domain.startsWith('*.')) {
                const domainSuffix = domain.substring(2);
                if (destination.endsWith(domainSuffix)) {
                    return { consent_required: false, reason: ['trusted_domain'], trusted_server: true };
                }
            } else if (destination === domain) {
                return { consent_required: false, reason: ['trusted_domain'], trusted_server: true };
            }
        }
        
        // Check target category
        const targetInfo = target_categories?.[destination];
        if (targetInfo && !targetInfo.requires_consent) {
            return { consent_required: false, reason: ['category_exemption'], trusted_server: true };
        }
        
        // Check consent requirements based on operation and target type
        const reasons: string[] = [];
        let consentRequired = false;
        
        if (user_consent_settings.require_consent_for.any_transfer && data_usage === 'transfer') {
            reasons.push('any_transfer_policy');
            consentRequired = true;
        }
        
        if (user_consent_settings.require_consent_for.sensitive_data_transfer && tool?.isSensitive) {
            reasons.push('sensitive_data_transfer');
            consentRequired = true;
        }
        
        // LLM-specific checks
        if (target.type === 'llm') {
            if (user_consent_settings.require_consent_for.llm_data_access) {
                reasons.push('llm_data_access_policy');
                consentRequired = true;
            }
            
            // Check LLM data retention policy
            if (targetInfo?.metadata?.data_retention === 'permanent') {
                reasons.push('llm_permanent_retention');
                consentRequired = true;
            }
        }
        
        // Server-specific checks
        if (target.type === 'server') {
            if (user_consent_settings.require_consent_for.external_server_transfer && 
                targetInfo?.category === 'external') {
                reasons.push('external_server_transfer');
                consentRequired = true;
            }
        }
        
        if (consentRequired) {
            return {
                consent_required: true,
                reason: reasons,
                consent_cache_key: `${destination}_${data_usage}_${target.type}`,
                trusted_server: false,
                custom_message: tool?.dataPolicy?.consent_overrides?.custom_consent_message || 
                    `This operation will send data to ${target.type} '${destination}'. Do you want to proceed?`
            };
        }
    }
    
    return { consent_required: false, reason: ['no_consent_required'], trusted_server: true };
}

/**
 * Creates a consent request object using unified target approach
 */
export function createConsentRequest(
    tool: Tool | undefined,
    usageContext: McppUsageContext,
    serverConfig: McppServerConfig,
    placeholderData: any
): ConsentRequest {
    const requestId = `consent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const destination = usageContext.target.destination as string;
    const targetInfo = serverConfig.global_policies.target_categories[destination];
    
    // Analyze placeholder data to extract summary
    let placeholderCount = 0;
    let dataTypes: string[] = [];
    let sensitiveFields: string[] = [];
    
    if (typeof placeholderData === 'string') {
        const matches = placeholderData.match(/\{[^}]+\}/g);
        placeholderCount = matches?.length || 0;
    } else if (typeof placeholderData === 'object') {
        const jsonStr = JSON.stringify(placeholderData);
        const matches = jsonStr.match(/\{[^}]+\}/g);
        placeholderCount = matches?.length || 0;
    }
    
    // Extract field names from placeholders (simplified)
    if (placeholderData && typeof placeholderData === 'string') {
        const matches = placeholderData.match(/\{[^.]+\.[^.]+\.([^}]+)\}/g);
        if (matches) {
            dataTypes = [...new Set(matches.map(match => {
                const parts = match.slice(1, -1).split('.');
                return parts[2] || 'unknown';
            }))];
        }
    }
    
    // Mark common sensitive field patterns
    sensitiveFields = dataTypes.filter(field => 
        field.toLowerCase().includes('email') ||
        field.toLowerCase().includes('phone') ||
        field.toLowerCase().includes('ssn') ||
        field.toLowerCase().includes('credit') ||
        field.toLowerCase().includes('password')
    );
    
    return {
        request_id: requestId,
        tool_name: tool?.name || 'unknown',
        data_summary: {
            placeholder_count: placeholderCount,
            data_types: dataTypes,
            sensitive_fields: sensitiveFields
        },
        transfer_details: {
            destination_server: destination,
            destination_description: targetInfo?.description,
            data_usage: usageContext.data_usage,
            trust_level: targetInfo?.trust_level || 'low'
        },
        options: {
            allow_remember: serverConfig.global_policies.user_consent_settings.allow_remember_choice,
            timeout_seconds: serverConfig.global_policies.user_consent_settings.consent_timeout_seconds,
            show_data_preview: serverConfig.global_policies.user_consent_settings.show_data_preview
        },
        custom_message: tool?.dataPolicy?.consent_overrides?.custom_consent_message
    };
}

/**
 * Complete validation function that checks all aspects
 */
export function validateDataAccess(
    tool: Tool | undefined,
    usageContext: McppUsageContext,
    serverConfig: McppServerConfig,
    placeholderData?: any
): {
    allowed: boolean;
    error_code?: number;
    error_message?: string;
    consent_request?: ConsentRequest;
    validation_details: {
        data_usage_valid: boolean;
        target_permissions_valid: boolean;
        consent_check: ConsentCheckResult;
    };
} {
    // 1. Validate data usage permissions
    const effectivePermission = getEffectiveDataUsagePermission(tool, usageContext.data_usage, serverConfig);
    
    if (effectivePermission === 'deny') {
        return {
            allowed: false,
            error_code: MCPP_ERRORS.INSUFFICIENT_PERMISSIONS,
            error_message: `Data usage '${usageContext.data_usage}' is not permitted for this tool`,
            validation_details: {
                data_usage_valid: false,
                target_permissions_valid: false,
                consent_check: { consent_required: false, reason: ['denied'], trusted_server: false }
            }
        };
    }
    
    // 2. Validate target permissions
    const targetValidation = validateTargetPermissions(tool, usageContext, serverConfig);
    if (!targetValidation.allowed) {
        return {
            allowed: false,
            error_code: MCPP_ERRORS.INSUFFICIENT_PERMISSIONS,
            error_message: `Target access denied: ${targetValidation.reason}`,
            validation_details: {
                data_usage_valid: true,
                target_permissions_valid: false,
                consent_check: { consent_required: false, reason: ['target_denied'], trusted_server: false }
            }
        };
    }
    
    // 3. Check consent requirements
    const consentCheck = checkConsentRequired(tool, usageContext, serverConfig);
    
    if (consentCheck.consent_required) {
        const consentRequest = createConsentRequest(tool, usageContext, serverConfig, placeholderData);
        return {
            allowed: false,
            error_code: MCPP_ERRORS.CONSENT_REQUIRED,
            error_message: 'User consent required for data transfer',
            consent_request: consentRequest,
            validation_details: {
                data_usage_valid: true,
                target_permissions_valid: true,
                consent_check: consentCheck
            }
        };
    }
    
    // 4. Check if prompt is required
    if (effectivePermission === 'prompt') {
        const consentRequest = createConsentRequest(tool, usageContext, serverConfig, placeholderData);
        return {
            allowed: false,
            error_code: MCPP_ERRORS.CONSENT_REQUIRED,
            error_message: 'User confirmation required for this operation',
            consent_request: consentRequest,
            validation_details: {
                data_usage_valid: true,
                target_permissions_valid: true,
                consent_check: { ...consentCheck, consent_required: true, reason: ['prompt_required'] }
            }
        };
    }
    
    return {
        allowed: true,
        validation_details: {
            data_usage_valid: true,
            target_permissions_valid: true,
            consent_check: consentCheck
        }
    };
}
