import { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";

export type DataUsage = 'display' | 'process' | 'store' | 'transfer';

export interface Tool extends McpTool {
    isSensitive?: boolean;
    dataPolicy?: {
        data_usage_permissions?: {
            display?: 'allow' | 'deny' | 'prompt';
            process?: 'allow' | 'deny' | 'prompt';
            store?: 'allow' | 'deny' | 'prompt';
            transfer?: 'allow' | 'deny' | 'prompt';
        };
        target_permissions?: {
            allowed_targets?: string[] | 'all' | 'none'; // Unified list for all target types
            blocked_targets?: string[]; // Unified block list for all target types
            // Legacy support (can be deprecated)
            allowed_clients?: string[] | 'all' | 'none';
            allowed_servers?: string[] | 'all' | 'none';
            blocked_servers?: string[];
        };
        consent_overrides?: {
            always_require_consent?: boolean;
            never_require_consent?: boolean;
            custom_consent_message?: string;
            allowed_without_consent?: string[];
        };
    };
}

export interface ToolInputProperty {
    type: string;
    description: string;
    data_usage_intent?: DataUsage;
}

export interface McppUsageContext {
    data_usage: DataUsage;
    requester: {
        host_id: string;
        session_id?: string;
        timestamp: number;
    };
    target: {
        type: 'client' | 'server' | 'servers' | 'llm' | 'all';
        destination?: string | string[];
        purpose?: string;
        llm_metadata?: {
            model_name?: string; // e.g., "gpt-4", "claude-3", "llama-2"
            provider?: string; // e.g., "openai", "anthropic", "meta"
            context_window?: number; // Token limit
            capabilities?: string[]; // e.g., ["text_generation", "code_analysis"]
            data_retention_policy?: 'none' | 'temporary' | 'training_excluded';
        };
    };
}

export interface McppServerConfig {
    global_policies: {
        default_data_usage_policy: {
            display: 'allow' | 'deny' | 'prompt';
            process: 'allow' | 'deny' | 'prompt';
            store: 'allow' | 'deny' | 'prompt';
            transfer: 'allow' | 'deny' | 'prompt';
        };
        default_target_policy: {
            client: 'allow' | 'deny' | 'prompt';
            server: string[] | 'all' | 'none';
            servers: string[] | 'all' | 'none';
            llm: 'allow' | 'deny' | 'prompt';
            all: 'allow' | 'deny' | 'prompt';
        };
        user_consent_settings: {
            require_consent_for: {
                sensitive_data_transfer: boolean;
                external_server_transfer: boolean;
                cross_domain_transfer: boolean;
                llm_data_access: boolean;
                any_transfer: boolean;
            };
            consent_timeout_seconds: number;
            default_on_timeout: 'allow' | 'deny';
            cache_consent_duration_minutes: number;
            trusted_targets: string[]; // Unified list of trusted targets (servers, LLMs, clients)
            trusted_domains: string[];
            show_data_preview: boolean;
            show_destination_info: boolean;
            allow_remember_choice: boolean;
        };
        target_categories: {
            [target_identifier: string]: {
                type: 'server' | 'llm' | 'client' | 'other';
                category: 'internal' | 'partner' | 'external' | 'public';
                trust_level: 'high' | 'medium' | 'low';
                requires_consent: boolean;
                metadata?: {
                    // For LLMs
                    provider?: string;
                    model_type?: 'local' | 'cloud' | 'hybrid';
                    data_retention?: 'none' | 'temporary' | 'permanent';
                    allowed_data_types?: string[];
                    // For servers
                    domain?: string;
                    // For clients
                    application_type?: string;
                };
                description?: string;
            };
        };
    };
}

export interface ConsentCheckResult {
    consent_required: boolean;
    reason: string[];
    consent_cache_key?: string;
    trusted_server: boolean;
    custom_message?: string;
}

export interface ConsentRequest {
    request_id: string;
    tool_name: string;
    data_summary: {
        placeholder_count: number;
        data_types: string[];
        sensitive_fields: string[];
    };
    transfer_details: {
        destination_server: string;
        destination_description?: string;
        data_usage: DataUsage;
        trust_level: 'high' | 'medium' | 'low';
    };
    options: {
        allow_remember: boolean;
        timeout_seconds: number;
        show_data_preview: boolean;
    };
    custom_message?: string;
}

export interface McppResolutionResult {
    success: boolean;
    value: any;
}

export interface McppResolutionTracking {
    resolved_data: any;
    resolution_status: {
        total_placeholders: number;
        resolved_placeholders: number;
        failed_placeholders: number;
        success_rate: number;
    };
}

export interface McppTableData {
    type: 'table';
    payload: {
        headers: string[];
        rows: any[][];
    };
}

export interface McppDataResponse {
    message: string;
    rowCount: number;
    columnNames: string[];
    dataRefId: string;
}

export interface McppErrorResponse {
    jsonrpc: "2.0";
    error: {
        code: number;
        message: string;
        data?: any;
    };
    id: number | string;
}
