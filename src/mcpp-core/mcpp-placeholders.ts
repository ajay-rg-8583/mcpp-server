export const PLACEHOLDER_REGEX = /\{([a-zA-Z0-9_\-]+\.[0-9]+\.[a-zA-Z0-9_\-]+)\}/g;
export const SINGLE_PLACEHOLDER_REGEX = /^\{([a-zA-Z0-9_\-]+\.[0-9]+\.[a-zA-Z0-9_\-]+)\}$/;

import { dataCache } from "./mcpp-cache.js";
import type { McppResolutionResult, McppResolutionTracking } from './mcpp-types.js';

/**
 * Resolves a single placeholder to its actual value from cached data
 * @param placeholder - The placeholder string (without curly braces)
 * @param cache - The data cache instance
 * @returns Object with success status and resolved value
 */
export function resolveSinglePlaceholder(
    placeholder: string, 
    cache: { get: (id: string) => any }
): McppResolutionResult {
    const parts = placeholder.split('.');
    if (parts.length !== 3) {
        return { success: false, value: null };
    }

    const [toolCallId, rowIndexStr, columnName] = parts;
    const rowIndex = parseInt(rowIndexStr, 10);
    
    if (isNaN(rowIndex)) {
        return { success: false, value: null };
    }

    const cachedData = cache.get(toolCallId);
    if (!cachedData || cachedData.type !== 'table') {
        return { success: false, value: null };
    }

    const { headers, rows } = cachedData.payload;
    const columnIndex = headers.indexOf(columnName);
    
    if (columnIndex === -1 || !rows[rowIndex]) {
        return { success: false, value: null };
    }

    return { success: true, value: rows[rowIndex][columnIndex] };
}

/**
 * Recursively resolves placeholders in tool arguments
 * @param args - The arguments that may contain placeholders
 * @param cache - The data cache instance
 * @returns Promise with resolved arguments
 */
export async function resolveArgumentPlaceholders(
    args: any, 
    cache: { get: (id: string) => any }
): Promise<any> {
    function resolveInObject(obj: any): any {
        if (typeof obj === 'string') {
            // Handle single placeholder that should preserve type
            const singleMatch = obj.match(SINGLE_PLACEHOLDER_REGEX);
            if (singleMatch) {
                const placeholder = singleMatch[1];
                const result = resolveSinglePlaceholder(placeholder, cache);
                if (result.success) {
                    return result.value;
                } else {
                    return obj; // Keep original if resolution fails
                }
            }

            // Handle multiple placeholders in string
            return obj.replace(PLACEHOLDER_REGEX, (match, placeholder) => {
                const result = resolveSinglePlaceholder(placeholder, cache);
                if (result.success) {
                    return String(result.value);
                } else {
                    return match; // Keep original placeholder if resolution fails
                }
            });
        } else if (Array.isArray(obj)) {
            return obj.map(resolveInObject);
        } else if (obj && typeof obj === 'object') {
            const resolved: any = {};
            for (const [key, value] of Object.entries(obj)) {
                resolved[key] = resolveInObject(value);
            }
            return resolved;
        }
        return obj;
    }

    return resolveInObject(args);
}

/**
 * Recursively resolves placeholders in complex data structures with tracking
 * @param data - The data structure that may contain placeholders
 * @param cache - The data cache instance
 * @returns Object with resolved data and resolution statistics
 */
export async function resolveWithTracking(
    data: any, 
    cache: { get: (id: string) => any }
): Promise<McppResolutionTracking> {
    let totalPlaceholders = 0;
    let resolvedPlaceholders = 0;
    let failedPlaceholders = 0;

    function countPlaceholders(obj: any): void {
        if (typeof obj === 'string') {
            const matches = obj.match(PLACEHOLDER_REGEX);
            if (matches) {
                totalPlaceholders += matches.length;
            }
        } else if (Array.isArray(obj)) {
            obj.forEach(countPlaceholders);
        } else if (obj && typeof obj === 'object') {
            Object.values(obj).forEach(countPlaceholders);
        }
    }

    function resolveInObject(obj: any): any {
        if (typeof obj === 'string') {
            // Handle single placeholder that should preserve type
            const singleMatch = obj.match(SINGLE_PLACEHOLDER_REGEX);
            if (singleMatch) {
                const placeholder = singleMatch[1];
                const result = resolveSinglePlaceholder(placeholder, cache);
                if (result.success) {
                    resolvedPlaceholders++;
                    return result.value;
                } else {
                    failedPlaceholders++;
                    return obj;
                }
            }

            // Handle multiple placeholders in string
            return obj.replace(PLACEHOLDER_REGEX, (match, placeholder) => {
                const result = resolveSinglePlaceholder(placeholder, cache);
                if (result.success) {
                    resolvedPlaceholders++;
                    return String(result.value);
                } else {
                    failedPlaceholders++;
                    return match;
                }
            });
        } else if (Array.isArray(obj)) {
            return obj.map(resolveInObject);
        } else if (obj && typeof obj === 'object') {
            const resolved: any = {};
            for (const [key, value] of Object.entries(obj)) {
                resolved[key] = resolveInObject(value);
            }
            return resolved;
        }
        return obj;
    }

    // Count total placeholders first
    countPlaceholders(data);

    // Resolve placeholders
    const resolved_data = resolveInObject(data);

    const resolution_status = {
        total_placeholders: totalPlaceholders,
        resolved_placeholders: resolvedPlaceholders,
        failed_placeholders: failedPlaceholders,
        success_rate: totalPlaceholders > 0 ? (resolvedPlaceholders / totalPlaceholders) * 100 : 100
    };

    return { resolved_data, resolution_status };
}
