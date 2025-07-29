import { Tool } from "./mcpp-types.js";
import { dataCache } from "./mcpp-cache.js";

/**
 * Converts array data to standardized table format for consistent processing
 * @param dataArray - Array of objects to convert
 * @param columnMappingOrMandatoryColumns - Either column mapping object or array of mandatory columns
 * @param mandatoryColumns - Optional array of column names to include. If empty, all columns are included
 * @param expandJsonObjects - Whether to expand JSON objects into separate columns (default: true)
 * @returns Standardized table object with headers and rows
 */
export function convertToTableFormat(
    dataArray: any[], 
    columnMappingOrMandatoryColumns: { [key: string]: string } | string[] = {},
    mandatoryColumns: string[] = [],
    expandJsonObjects: boolean = true
): any {
    // Handle function overloading - if second param is array, treat it as mandatoryColumns
    let columnMapping: { [key: string]: string } = {};
    let actualMandatoryColumns: string[] = mandatoryColumns;
    
    if (Array.isArray(columnMappingOrMandatoryColumns)) {
        // Second parameter is mandatoryColumns array
        actualMandatoryColumns = columnMappingOrMandatoryColumns;
    } else {
        // Second parameter is columnMapping object
        columnMapping = columnMappingOrMandatoryColumns || {};
    }
    if (!Array.isArray(dataArray) || dataArray.length === 0) {
        return {
            type: 'table',
            payload: {
                headers: [],
                rows: []
            }
        };
    }
    
    if (expandJsonObjects) {
        // New behavior: expand JSON objects into separate columns
        const expandedData = dataArray.map(item => {
            const expandedItem: any = {};
            
            Object.keys(item).forEach(key => {
                const value = item[key];
                
                if (value !== null && value !== undefined) {
                    let processedValue = value;
                    
                    // Try to parse string values as JSON
                    if (typeof value === 'string' && !/^-?\d+$/.test(value)) {
                        try {
                            processedValue = JSON.parse(value);
                        } catch (e) {
                            processedValue = value;
                        }
                    }
                    
                    // If it's an object, expand it into separate columns
                    if (typeof processedValue === 'object' && processedValue !== null) {
                        // Expand object properties into separate columns
                        Object.keys(processedValue).forEach(subKey => {
                            const columnName = `${key}_${subKey}`;
                            const subValue = processedValue[subKey];
                            expandedItem[columnName] = subValue === null || subValue === undefined ? "" : String(subValue);
                        });
                    } else {
                        expandedItem[key] = String(processedValue);
                    }
                } else {
                    expandedItem[key] = "";
                }
            });
            
            return expandedItem;
        });
        
        // Get all available columns from the expanded data
        const allExpandedHeaders = Array.from(new Set(
            expandedData.flatMap(item => Object.keys(item))
        )).sort();
        
        // Filter columns based on actualMandatoryColumns
        let finalHeaders: string[];
        if (actualMandatoryColumns.length > 0) {
            // When mandatory columns are specified, include both original and expanded column names
            finalHeaders = allExpandedHeaders.filter(header => {
                // Check if this header matches any mandatory column or is an expansion of one
                return actualMandatoryColumns.some(mandatoryCol => 
                    header === mandatoryCol || header.startsWith(`${mandatoryCol}_`)
                );
            });
        } else {
            finalHeaders = allExpandedHeaders;
        }
        
        // Apply column mapping to the final headers
        const headers = finalHeaders.map(header => columnMapping[header] || header);

        const rows = expandedData.map(item => finalHeaders.map(header => {
            return item[header] || "";
        }));
        
        return {
            type: 'table',
            payload: { headers, rows }
        };
    } else {
        // Original behavior: keep JSON objects as single string columns
        // Get all available columns from the first object
        const allOriginalHeaders = Object.keys(dataArray[0]);
        
        // Filter columns based on actualMandatoryColumns
        const originalHeaders = actualMandatoryColumns.length > 0 
            ? allOriginalHeaders.filter(header => actualMandatoryColumns.includes(header))
            : allOriginalHeaders;
        
        // Apply column mapping to the filtered headers
        const headers = originalHeaders.map(header => columnMapping[header] || header);

        const rows = dataArray.map(item => originalHeaders.map(header => {
            const value = item[header];
            if (value === null || value === undefined) {
                return "";
            }
            
            let processedValue = value;
            if (typeof value === 'string') {
                if (!/^-?\d+$/.test(value)) {
                    try {
                        processedValue = JSON.parse(value);
                    } catch (e) {
                        // Not a JSON string, keep it as a string.
                    }
                }
            }

            if (typeof processedValue === 'object' && processedValue !== null) {
                return JSON.stringify(processedValue);
            }

            return String(processedValue);
        }));
        
        return {
            type: 'table',
            payload: { headers, rows }
        };
    }
}

/**
 * Processes data response based on tool sensitivity
 * @param tool - The tool definition
 * @param tool_call_id - The tool call ID
 * @param standardizedData - The standardized data
 * @param itemKind - The kind of item being processed
 * @returns Processed data response
 */
export function processDataResponse(tool: Tool | undefined, tool_call_id: string, standardizedData: any, itemKind: string) {
    if (tool?.isSensitive) {
        dataCache.set(tool_call_id, standardizedData);
        const rowCount = standardizedData.payload.rows.length;
        const columnNames = standardizedData.payload.headers;
        const summary = {
            message: `Successfully fetched ${rowCount} ${itemKind}.`,
            rowCount: rowCount,
            columnNames: columnNames,
            dataRefId: tool_call_id
        };
        return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
    } else {
        return {
            content: [{ type: "text", text: JSON.stringify(standardizedData, null, 2) }],
        };
    }
}

/**
 * Converts array data to table format with JSON objects expanded into separate columns
 * This is a convenience function that calls convertToTableFormat with expandJsonObjects=true
 * @param dataArray - Array of objects to convert
 * @param mandatoryColumns - Optional array of column names to include
 * @param columnMapping - Optional mapping for renaming columns
 * @returns Standardized table object with headers and rows, JSON objects expanded
 */
export function convertToExpandedTableFormat(
    dataArray: any[], 
    mandatoryColumns: string[] = [],
    columnMapping: { [key: string]: string } = {}
): any {
    return convertToTableFormat(dataArray, columnMapping, mandatoryColumns, true);
}

/**
 * Converts array data to table format with JSON objects kept as single string columns
 * This is a convenience function that calls convertToTableFormat with expandJsonObjects=false
 * @param dataArray - Array of objects to convert
 * @param mandatoryColumns - Optional array of column names to include
 * @param columnMapping - Optional mapping for renaming columns
 * @returns Standardized table object with headers and rows, JSON objects as strings
 */
export function convertToCompactTableFormat(
    dataArray: any[], 
    mandatoryColumns: string[] = [],
    columnMapping: { [key: string]: string } = {}
): any {
    return convertToTableFormat(dataArray, columnMapping, mandatoryColumns, false);
}
