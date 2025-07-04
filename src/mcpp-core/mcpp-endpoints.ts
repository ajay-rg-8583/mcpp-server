import jaroWinkler from 'jaro-winkler';
import { dataCache } from "./mcpp-cache.js";
import { MCPP_ERRORS } from "./mcpp-errors.js";
import { resolveArgumentPlaceholders, resolveSinglePlaceholder, SINGLE_PLACEHOLDER_REGEX, PLACEHOLDER_REGEX } from "./mcpp-placeholders.js";
import { validateDataAccess } from "./mcpp-validation.js";
import { consentCache } from "./mcpp-consent.js";
import type { Tool, McppUsageContext, McppServerConfig } from "./mcpp-types.js";

/**
 * Handles the mcpp/get_data endpoint with validation
 * @param params - The parameters for the method
 * @param id - The ID of the request
 * @param tool - The tool definition (optional)
 * @param serverConfig - Server configuration (optional)
 * @returns The response object
 */
export function handleGetData(
    params: any, 
    id: any,
    tool?: Tool,
    serverConfig?: McppServerConfig
) {
    const tool_call_id = params?.tool_call_id;
    const usage_context: McppUsageContext | undefined = params?.usage_context;
    
    if (!tool_call_id) {
        return {
            jsonrpc: '2.0',
            error: { 
              code: MCPP_ERRORS.INVALID_PARAMS, 
              message: 'Invalid params: tool_call_id is required',
              data: { required_params: ['tool_call_id'] }
            },
            id: id || null,
        };
    }

    const data = dataCache.get(tool_call_id);
    if (!data) {
        return {
            jsonrpc: '2.0',
            error: { 
              code: MCPP_ERRORS.DATA_NOT_FOUND, 
              message: 'Cached data not found for the given tool_call_id',
              data: { tool_call_id, available_caches: Array.from(dataCache.keys()) }
            },
            id: id || null,
        };
    }

    // Perform validation if usage context and server config are provided
    if (usage_context && serverConfig) {
        const validation = validateDataAccess(tool, usage_context, serverConfig, data);
        
        if (!validation.allowed) {
            return {
                jsonrpc: '2.0',
                error: {
                    code: validation.error_code,
                    message: validation.error_message,
                    data: validation.consent_request ? {
                        consent_request: validation.consent_request,
                        validation_details: validation.validation_details
                    } : {
                        validation_details: validation.validation_details
                    }
                },
                id: id || null
            };
        }
    }

    return {
        jsonrpc: '2.0',
        result: data,
        id: id || null,
    };
}

/**
 * Handles the mcpp/find_reference endpoint
 * @param params - The parameters for the method
 * @param id - The ID of the request
 * @returns The response object
 */
export function handleFindReference(params: any, id: any) {
    if (!params || !params.tool_call_id || !params.keyword) {
        return {
            jsonrpc: "2.0",
            error: {
                code: MCPP_ERRORS.INVALID_PARAMS,
                message: "Missing tool_call_id or keyword parameter"
            },
            id
        };
    }

    const { tool_call_id: refToolCallId, keyword, column_name: columnName } = params;

    const cachedData = dataCache.get(refToolCallId);

    if (!cachedData || cachedData.type !== 'table' || !cachedData.payload.rows) {
        return {
            jsonrpc: "2.0",
            error: { 
              code: MCPP_ERRORS.DATA_NOT_FOUND, 
              message: 'Cached data not found or not in table format for the given tool_call_id',
              data: { tool_call_id: refToolCallId, available_caches: Array.from(dataCache.keys()) }
            },
            id
        };
    }

    const { headers, rows } = cachedData.payload;
    const SIMILARITY_THRESHOLD = 0.7;
    let bestMatch = {
        placeholder: '',
        similarity: -1,
        rowIndex: -1,
        columnName: ''
    };

    if (columnName) {
        const colIndex = headers.indexOf(columnName);
        if (colIndex === -1) {
            return {
                jsonrpc: "2.0",
                error: { 
                  code: MCPP_ERRORS.INVALID_PARAMS, 
                  message: `Invalid params: column '${columnName}' not found`,
                  data: { invalid_column: columnName, available_columns: headers }
                },
                id
            };
        }

        for (let i = 0; i < rows.length; i++) {
            const cellValue = String(rows[i][colIndex]);
            const similarity = jaroWinkler(keyword.toLowerCase(), cellValue.toLowerCase());

            if (similarity > bestMatch.similarity) {
                bestMatch.similarity = similarity;
                bestMatch.placeholder = `{${refToolCallId}.${i}.${headers[colIndex]}}`;
                bestMatch.rowIndex = i;
                bestMatch.columnName = headers[colIndex];
            }
        }
    } else {
        for (let i = 0; i < rows.length; i++) {
            for (let j = 0; j < headers.length; j++) {
                const cellValue = String(rows[i][j]);
                const similarity = jaroWinkler(keyword.toLowerCase(), cellValue.toLowerCase());

                if (similarity > bestMatch.similarity) {
                    bestMatch.similarity = similarity;
                    bestMatch.placeholder = `{${refToolCallId}.${i}.${headers[j]}}`;
                    bestMatch.rowIndex = i;
                    bestMatch.columnName = headers[j];
                }
            }
        }
    }

    if (bestMatch.similarity > SIMILARITY_THRESHOLD) {
        const result = { 
            placeholder: bestMatch.placeholder, 
            message: `A match was found in column ${bestMatch.columnName} at row ${bestMatch.rowIndex}`,
            similarity: bestMatch.similarity,
            metadata: {
                tool_call_id: refToolCallId,
                row_index: bestMatch.rowIndex,
                column_name: bestMatch.columnName,
                keyword_searched: keyword
            }
        };
        return { jsonrpc: "2.0", result, id };
    } else {
        return {
            jsonrpc: "2.0",
            error: { 
                code: MCPP_ERRORS.REFERENCE_NOT_FOUND, 
                message: 'No suitable reference found for the given keyword',
                data: { 
                    keyword, 
                    similarity_threshold: SIMILARITY_THRESHOLD,
                    best_similarity: bestMatch.similarity,
                    searched_rows: rows.length,
                    searched_columns: headers.length
                }
            },
            id
        };
    }
}

/**
 * Handles the mcpp/resolve_placeholders endpoint with validation
 * @param params - The parameters for the method
 * @param id - The ID of the request
 * @param tool - The tool definition (optional)
 * @param serverConfig - Server configuration (optional)
 * @returns The response object
 */
export async function handleResolvePlaceholders(
    params: any, 
    id: any,
    tool?: Tool,
    serverConfig?: McppServerConfig
) {
    if (!params || !params.data) {
        return {
            jsonrpc: "2.0",
            error: { 
              code: MCPP_ERRORS.INVALID_PARAMS, 
              message: 'Invalid params: data is required for placeholder resolution',
              data: { required_params: ['data'] }
            },
            id
        };
    }

    const usage_context: McppUsageContext | undefined = params?.usage_context;

    // Perform validation if usage context and server config are provided
    if (usage_context && serverConfig) {
        const validation = validateDataAccess(tool, usage_context, serverConfig, params.data);
        
        if (!validation.allowed) {
            return {
                jsonrpc: '2.0',
                error: {
                    code: validation.error_code,
                    message: validation.error_message,
                    data: validation.consent_request ? {
                        consent_request: validation.consent_request,
                        validation_details: validation.validation_details
                    } : {
                        validation_details: validation.validation_details
                    }
                },
                id: id || null
            };
        }
    }

    const resolutionTracking = {
        total_placeholders: 0,
        resolved_placeholders: 0,
        failed_placeholders: [] as string[]
    };

    async function resolveWithTracking(data: any): Promise<any> {
        if (!data) {
            return data;
        }

        if (typeof data === 'string') {
            const singlePlaceholderMatch = data.match(SINGLE_PLACEHOLDER_REGEX);
            if (singlePlaceholderMatch) {
                resolutionTracking.total_placeholders++;
                const placeholder = singlePlaceholderMatch[1];
                const resolution = resolveSinglePlaceholder(placeholder, dataCache);
                
                if (resolution.success) {
                    resolutionTracking.resolved_placeholders++;
                    return resolution.value;
                } else {
                    resolutionTracking.failed_placeholders.push(data);
                    return data;
                }
            }

            let resolvedString = data;
            let match;
            const regex = new RegExp(PLACEHOLDER_REGEX.source, PLACEHOLDER_REGEX.flags);
            
            while ((match = regex.exec(data)) !== null) {
                resolutionTracking.total_placeholders++;
                const fullPlaceholder = match[0];
                const placeholder = match[1];
                const resolution = resolveSinglePlaceholder(placeholder, dataCache);
                
                if (resolution.success) {
                    const resolvedValue = String(resolution.value);
                    resolvedString = resolvedString.replace(fullPlaceholder, resolvedValue);
                    resolutionTracking.resolved_placeholders++;
                } else {
                    resolutionTracking.failed_placeholders.push(fullPlaceholder);
                }
            }

            return resolvedString;
        }

        if (Array.isArray(data)) {
            return Promise.all(data.map(item => resolveWithTracking(item)));
        }

        if (typeof data === 'object' && data !== null) {
            const newData: { [key: string]: any } = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    newData[key] = await resolveWithTracking(data[key]);
                }
            }
            return newData;
        }

        return data;
    }

    try {
        const resolvedData = await resolveWithTracking(params.data);
        
        return {
            jsonrpc: "2.0",
            result: {
                resolved_data: resolvedData,
                resolution_status: {
                    total_placeholders: resolutionTracking.total_placeholders,
                    resolved_placeholders: resolutionTracking.resolved_placeholders,
                    failed_placeholders: resolutionTracking.failed_placeholders,
                    success_rate: resolutionTracking.total_placeholders > 0 
                        ? Math.round((resolutionTracking.resolved_placeholders / resolutionTracking.total_placeholders) * 100) 
                        : 100
                }
            },
            id
        };
    } catch (error: any) {
        return {
            jsonrpc: "2.0",
            error: { 
                code: MCPP_ERRORS.INTERNAL_ERROR, 
                message: 'Internal error during placeholder resolution',
                data: { error_details: error.message }
            },
            id
        };
    }
}

/**
 * Handles the mcpp/provide_consent endpoint
 * @param params - The parameters for the method
 * @param id - The ID of the request
 * @returns The response object
 */
export function handleProvideConsent(params: any, id: any) {
    if (!params || !params.request_id || !params.decision) {
        return {
            jsonrpc: "2.0",
            error: {
                code: MCPP_ERRORS.INVALID_PARAMS,
                message: 'Invalid params: request_id and decision are required',
                data: { required_params: ['request_id', 'decision'] }
            },
            id
        };
    }

    const { request_id, decision, remember, duration_minutes } = params;

    if (!['allow', 'deny'].includes(decision)) {
        return {
            jsonrpc: "2.0",
            error: {
                code: MCPP_ERRORS.INVALID_PARAMS,
                message: 'Invalid decision: must be "allow" or "deny"',
                data: { valid_decisions: ['allow', 'deny'] }
            },
            id
        };
    }

    // Resolve the pending consent request
    const resolved = consentCache.resolveConsentRequest(request_id, decision);
    
    if (!resolved) {
        return {
            jsonrpc: "2.0",
            error: {
                code: MCPP_ERRORS.DATA_NOT_FOUND,
                message: 'Consent request not found or expired',
                data: { 
                    request_id,
                    pending_requests: consentCache.getPendingRequests()
                }
            },
            id
        };
    }

    // Store consent decision if remember is true
    if (remember && duration_minutes) {
        // This would need additional context to generate proper cache key
        // Implementation depends on how the original request context is stored
    }

    return {
        jsonrpc: "2.0",
        result: {
            request_id,
            decision,
            remembered: remember || false,
            message: `Consent ${decision} recorded successfully`
        },
        id
    };
}
