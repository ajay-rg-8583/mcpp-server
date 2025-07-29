# MCPP Core

**Model Context Privacy Protocol (MCPP) Core Utilities**

A TypeScript library that extends the Model Context Protocol (MCP) with privacy-enhanced data handling capabilities. MCPP enables AI assistants to work with sensitive data through references and placeholders, ensuring that raw sensitive data is never directly exposed to the AI while maintaining full operational capability.

## Features

- 🔒 **Privacy-First**: Sensitive data is cached server-side with only references exposed
- 🔄 **Placeholder System**: Automatic resolution of data placeholders in tool arguments
- 📊 **Data Standardization**: Convert data to consistent table format
- 🔍 **Fuzzy Search**: Find data references using Jaro-Winkler algorithm
- ⚡ **Cache Management**: Efficient in-memory data caching
- 🛠 **Tool Sensitivity**: Mark tools as sensitive or non-sensitive

## Installation

```bash
npm install @your-username/mcpp-core
```

## Quick Start

```typescript
import {
  Tool,
  convertToTableFormat,
  processDataResponse,
  resolveArgumentPlaceholders,
  dataCache
} from '@your-username/mcpp-core';

// Define a sensitive tool
const sensitiveTools: Tool[] = [
  {
    name: "get_users",
    description: "Get user data",
    isSensitive: true,
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

// Convert data to table format
const data = [
  { id: 1, name: "John", email: "john@example.com" },
  { id: 2, name: "Jane", email: "jane@example.com" }
];

const tableData = convertToTableFormat(data);

// Process response based on tool sensitivity
const tool = sensitiveTools[0];
const response = processDataResponse(tool, "tool_call_123", tableData, "users");
```

## Core Concepts

### Sensitive vs Non-Sensitive Tools
- Tools marked with `isSensitive: true` cache data server-side and return only summaries
- Non-sensitive tools return full data directly (standard MCP behavior)

### Placeholder System
- Format: `{tool_call_id.row_index.column_name}`
- Example: `{abc123.5.ID}` refers to the ID field in row 5 of cached data
- Automatic resolution in tool arguments

### Data Caching
- Server maintains in-memory cache indexed by tool_call_id
- Standardized table format with headers and rows
- Only sensitive tool outputs are cached

## API Reference

### Core Functions

#### `convertToTableFormat(data, columnMapping?, mandatoryColumns?)`
Converts array data to standardized table format.

#### `processDataResponse(tool, toolCallId, standardizedData, itemKind)`
Processes data response based on tool sensitivity.

#### `resolveArgumentPlaceholders(args, cache?)`
Resolves placeholders in tool arguments.

### MCPP Endpoints

#### `handleGetData(params, id)`
Retrieve cached sensitive data for UI display.

#### `handleFindReference(params, id)`
Find data references using fuzzy search.

#### `handleResolvePlaceholders(params, id)`
Bulk resolve placeholders in complex data structures.

## Types

```typescript
interface Tool extends McpTool {
  isSensitive?: boolean;
}

interface TableData {
  type: 'table';
  payload: {
    headers: string[];
    rows: any[][];
  };
}
```

## Error Codes

- `MCPP_ERRORS.INVALID_PARAMS` (-32602)
- `MCPP_ERRORS.DATA_NOT_FOUND` (-32004)
- `MCPP_ERRORS.CACHE_MISS` (-32001)
- `MCPP_ERRORS.REFERENCE_NOT_FOUND` (-32002)
- `MCPP_ERRORS.RESOLUTION_FAILED` (-32003)
- `MCPP_ERRORS.INTERNAL_ERROR` (-32603)

## Examples

### Creating a Sensitive Tool

```typescript
const tool: Tool = {
  name: "get_sensitive_records",
  description: "Get sensitive user records",
  isSensitive: true,
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" }
    }
  }
};
```

### Using Placeholders

```typescript
// AI receives summary with dataRefId
// Later uses placeholder in another tool call
const updateArgs = {
  recordId: "{tool_call_abc123.5.ID}",
  data: { status: "updated" }
};

// Automatically resolved before tool execution
const resolvedArgs = await resolveArgumentPlaceholders(updateArgs);
// resolvedArgs.recordId now contains the actual ID value
```

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## Support

For questions and support, please open an issue on our GitHub repository.
