import { Tool } from "./mcpp-types.js";
import { dataCache } from "./mcpp-cache.js";

/**
 * Converts array data to standardized table format for consistent processing
 * @param dataArray - Array of objects to convert
 * @param columnMappingOrMandatoryColumns - Either column mapping object or array of mandatory columns
 * @param mandatoryColumns - Optional array of column names to include. If empty, all columns are included
 * @returns Standardized table object with headers and rows
 */
export function convertToTableFormat(
    dataArray: any[], 
    columnMappingOrMandatoryColumns: { [key: string]: string } | string[] = {},
    mandatoryColumns: string[] = []
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
            if ('zc_display_value' in processedValue) {
                const displayValue = processedValue.zc_display_value;
                if (displayValue === null || displayValue === undefined) {
                    return "";
                }
                if (typeof displayValue === 'object') {
                    return JSON.stringify(displayValue);
                }
                return String(displayValue);
            }
            return JSON.stringify(processedValue);
        }

        return String(processedValue);
    }));

    return {
        type: 'table',
        payload: { headers, rows }
    };
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
