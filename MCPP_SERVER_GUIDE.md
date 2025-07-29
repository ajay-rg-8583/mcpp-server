# Model Context Privacy Protocol (MCPP) Server Implementation Guide

This guide defines the complete protocol specifications for implementing an MCPP-enabled server that can interact with MCPP hosts (clients) to manage sensitive data flows while maintaining privacy and security, including support for LLM targets and fine-grained access controls.

## Overview

The Model Context Privacy Protocol (MCPP) is an extension to the Model Context Protocol (MCP) that enables privacy-enhanced data handling for sensitive tool outputs. An MCPP server extends a standard MCP server with advanced privacy features:

1. **Enhanced Tool Execution**: Execute tools and cache sensitive outputs with privacy controls
2. **Data Caching**: Store tool outputs securely with metadata and lifecycle management
3. **Access Control Validation**: Enforce fine-grained access control policies based on usage context
4. **Consent Management**: Handle asynchronous user consent workflows for sensitive operations
5. **Placeholder Resolution**: Resolve placeholders back to actual values after permission validation
6. **Reference Finding**: Provide similarity-based search for cached data references
7. **Unified Target Support**: Handle LLMs, servers, and clients with consistent access control logic

## Key Features

- **🔒 Enhanced Privacy Controls**: Fine-grained data usage validation and access controls
- **🤖 LLM Target Support**: Native support for Language Model targets with specialized policies
- **🎯 Unified Access Controls**: Single framework for all target types (LLMs, servers, clients)
- **👤 Consent Management**: Asynchronous user consent flows with caching
- **📊 Hierarchical Data Usage**: display < process < store < transfer validation
- **🛡️ Target-Specific Policies**: Customizable policies per target with metadata support

## Protocol Specifications

### 1. Communication Protocol

MCPP uses JSON-RPC 2.0 over HTTP/HTTPS for communication between hosts and servers. All requests follow the standard JSON-RPC format:

```json
{
  "jsonrpc": "2.0",
  "method": "endpoint_name",
  "params": { /* endpoint-specific parameters */ },
  "id": "unique_request_id"
}
```

### 2. Base URL Structure

MCPP endpoints are accessed via the `/mcpp` path on the server:
- Base URL: `http://server-host:port/mcpp`
- All MCPP-specific methods use the `mcpp/` prefix

### 3. Core Data Structures

#### Usage Context Structure
```json
{
  "data_usage": "display" | "process" | "store" | "transfer",
  "requester": {
    "host_id": "string",
    "session_id": "string (optional)",
    "timestamp": "number"
  },
  "target": {
    "type": "client" | "server" | "llm" | "all",
    "destination": "string or array",
    "purpose": "string (optional)",
    "llm_metadata": {
      "model_name": "string (optional)",
      "provider": "string (optional)", 
      "context_window": "number (optional)",
      "capabilities": "array (optional)",
      "data_retention_policy": "none | temporary | training_excluded (optional)"
    }
  }
}
```

#### CachedData Structure
```json
{
  "type": "table" | "text" | "json",
  "payload": {
    // Type-specific data structure
  },
  "metadata": {
    "tool_name": "string",
    "timestamp": "number",
    "is_sensitive": "boolean"
  }
}
```

#### Table Data Format
```json
{
  "type": "table",
  "payload": {
    "headers": ["column1", "column2", "column3"],
    "rows": [
      ["value1", "value2", "value3"],
      ["value4", "value5", "value6"]
    ]
  }
}
```

#### Placeholder Format
Placeholders follow the pattern: `{tool_call_id.row_index.column_name}`
- Example: `{tool_12345.0.Name}` references row 0, column "Name" from tool call ID "tool_12345"

## MCPP Endpoint Specifications

MCPP servers must implement the following JSON-RPC 2.0 methods. These extend the standard MCP protocol:

### 1. Standard Tool Execution (Enhanced MCP)

**Endpoint**: Standard MCP `tools/call` method
**Purpose**: Execute tools on the server and receive results with MCPP enhancements

**Request Format**:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": {
      "param1": "value1",
      "param2": "value2"
    },
    "tool_call_id": "unique_identifier"
  },
  "id": "request_id"
}
```

**Server Logic**:
1. Execute the requested tool with the provided arguments
2. Generate a unique `tool_call_id` if not provided
3. Detect if the result contains sensitive data based on tool configuration
4. Cache the result with metadata (tool name, timestamp, sensitivity flag)
5. If sensitive, generate placeholders for the response
6. Return either the raw result or placeholdered result based on tool policy

**Response Format**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Tool execution result or placeholdered content"
      }
    ],
    "isError": false
  },
  "id": "request_id"
}
```

### 2. Data Retrieval Endpoint

**Endpoint**: `mcpp/get_data`
**Purpose**: Retrieve cached data from a previous tool execution, subject to access control validation.

**Request Format**:
```json
{
  "jsonrpc": "2.0",
  "method": "mcpp/get_data",
  "params": {
    "tool_call_id": "unique_tool_call_identifier",
    "usage_context": {
      "data_usage": "display" | "process" | "store" | "transfer",
      "requester": {
        "host_id": "string",
        "session_id": "string (optional)",
        "timestamp": "number"
      },
      "target": {
        "type": "client" | "server" | "llm" | "all",
        "destination": "string or array",
        "purpose": "string (optional)"
      }
    }
  },
  "id": "request_id"
}
```

**Server Logic**:
1. Find the cached data associated with the `tool_call_id`
2. If not found, return a `DATA_NOT_FOUND` error with available cache IDs
3. Validate the `usage_context` against the tool's `dataPolicy` and server's global policies
4. Check unified target permissions (`allowed_targets`, `blocked_targets`)
5. Validate data usage hierarchy (display < process < store < transfer)
6. Check if consent is required based on target type and trust level
7. If access is denied, return `INSUFFICIENT_PERMISSIONS` error
8. If consent is required, return `CONSENT_REQUIRED` error with consent request details
9. If access is granted, return the cached data

**Success Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "type": "table",
    "payload": {
      "headers": ["ID", "Name", "Email"],
      "rows": [
        ["1", "John Doe", "john@example.com"],
        ["2", "Jane Smith", "jane@example.com"]
      ]
    },
    "metadata": {
      "tool_name": "get_contacts",
      "timestamp": 1672531200000,
      "is_sensitive": true
    }
  },
  "id": "request_id"
}
```

**Error Response**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32004,
    "message": "Cached data not found for the given tool_call_id",
    "data": {
      "tool_call_id": "missing_id",
      "available_caches": ["tool_123", "tool_456"]
    }
  },
  "id": "request_id"
}
```

### 3. Reference Finding Endpoint

**Endpoint**: `mcpp/find_reference`
**Purpose**: Find a placeholder reference for a specific piece of data within a cached tool result using similarity matching

**Request Format**:
```json
{
  "jsonrpc": "2.0",
  "method": "mcpp/find_reference",
  "params": {
    "tool_call_id": "source_tool_call_id",
    "keyword": "search_term",
    "column_name": "optional_specific_column"
  },
  "id": "request_id"
}
```

**Server Logic**:
1. Validate required parameters (`tool_call_id` and `keyword`)
2. Retrieve the cached data for the given `tool_call_id`
3. Verify data is in table format with headers and rows
4. If `column_name` is specified, search only in that column
5. Otherwise, search across all columns in all rows
6. Use Jaro-Winkler similarity algorithm (threshold: 0.7) to find the best match
7. Return the placeholder with metadata if a match is found
8. Return `REFERENCE_NOT_FOUND` error if no suitable match is found

**Success Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "placeholder": "{tool_123.0.Name}",
    "metadata": {
      "similarity": 0.95,
      "keyword": "John Doe",
      "similarity_threshold": 0.7,
      "best_similarity": 0.95,
      "searched_rows": 10,
      "searched_columns": 5
    }
  },
  "id": "request_id"
}
```

**Error Response**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32002,
    "message": "No reference found for keyword: unknown_term",
    "data": {
      "keyword": "unknown_term",
      "tool_call_id": "tool_123",
      "similarity_threshold": 0.7
    }
  },
  "id": "request_id"
}
```

### 4. Placeholder Resolution Endpoint

**Endpoint**: `mcpp/resolve_placeholders`
**Purpose**: Resolve placeholders in a given text back to their actual values, enforcing access controls

**Request Format**:
```json
{
  "jsonrpc": "2.0",
  "method": "mcpp/resolve_placeholders",
  "params": {
    "data": "Hello {tool_123.0.Name}, your email is {tool_123.0.Email}",
    "usage_context": {
      "data_usage": "transfer",
      "requester": {
        "host_id": "llm_client_001",
        "session_id": "llm_session_456",
        "timestamp": 1672531200000
      },
      "target": {
        "type": "llm",
        "destination": "claude-3",
        "purpose": "customer_support",
        "llm_metadata": {
          "model_name": "claude-3",
          "provider": "anthropic",
          "context_window": 100000,
          "capabilities": ["text_generation", "analysis"],
          "data_retention_policy": "none"
        }
      }
    },
    "tool_name": "get_customer_records"
  },
  "id": "request_id"
}
```

**Server Logic**:
1. Validate required parameters (`data` is required)
2. Parse the `data` string to identify all placeholders using regex patterns
3. For each placeholder, perform access control validation using the `usage_context`
4. Check unified target permissions and data usage hierarchy
5. If any check requires user consent, return a `CONSENT_REQUIRED` error with detailed consent request
6. If any check fails due to permissions, return an `INSUFFICIENT_PERMISSIONS` error
7. If all checks pass, retrieve values from cache and substitute them into the string
8. Track resolution success/failure for each placeholder
9. Return resolved data with comprehensive resolution status

**Success Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "resolved_data": "Hello John Doe, your email is john@example.com",
    "resolution_status": {
      "total_placeholders": 2,
      "resolved_placeholders": 2,
      "failed_placeholders": 0,
      "success_rate": 100
    }
  },
  "id": "request_id"
}
```

**Consent Required Response**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32007,
    "message": "User consent required for data transfer",
    "data": {
      "consent_request": {
        "request_id": "consent_1672531200_abc123",
        "tool_name": "get_customer_records",
        "data_summary": {
          "placeholder_count": 2,
          "data_types": ["Name", "Email"],
          "sensitive_fields": ["Email"]
        },
        "transfer_details": {
          "destination_server": "claude-3",
          "destination_description": "Anthropic Claude 3 Language Model",
          "data_usage": "transfer",
          "trust_level": "high"
        },
        "options": {
          "allow_remember": true,
          "timeout_seconds": 30,
          "show_data_preview": true
        },
        "custom_message": "This operation will send customer data to Claude-3 for analysis. Do you want to proceed?"
      }
    }
  },
  "id": "request_id"
}
```

**Access Denied Response**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32005,
    "message": "Target access denied: llm_blocked_by_tool",
    "data": {
      "validation_details": {
        "data_usage_valid": true,
        "target_permissions_valid": false,
        "consent_check": {
          "consent_required": false,
          "reason": ["target_denied"],
          "trusted_server": false
        }
      }
    }
  },
  "id": "request_id"
}
```

### 5. Consent Management Endpoint

**Endpoint**: `mcpp/provide_consent`
**Purpose**: Receive and record a user's consent decision for a pending data access request

**Request Format**:
```json
{
  "jsonrpc": "2.0",
  "method": "mcpp/provide_consent",
  "params": {
    "request_id": "consent_1672531200_abc123",
    "decision": "allow" | "deny",
    "remember": false,
    "duration_minutes": 60
  },
  "id": "request_id"
}
```

**Server Logic**:
1. Validate required parameters (`request_id` and `decision`)
2. Verify decision is either "allow" or "deny"
3. Find the pending consent request matching `request_id`
4. If request not found or expired, return `DATA_NOT_FOUND` error
5. Record the consent decision in the consent cache
6. If `remember` is true, cache the consent decision for future requests
7. Set cache duration based on `duration_minutes` parameter
8. Resolve the pending request and allow/deny the original operation

**Success Response**:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "request_id": "consent_1672531200_abc123",
    "decision": "allow",
    "remembered": false,
    "message": "Consent allow recorded successfully"
  },
  "id": "request_id"
}
```

**Error Response**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32004,
    "message": "Consent request not found or expired",
    "data": {
      "request_id": "consent_1672531200_abc123",
      "pending_requests": ["consent_123", "consent_456"]
    }
  },
  "id": "request_id"
}
```

## Error Code Specifications

MCPP uses standard JSON-RPC error codes plus additional codes for privacy-specific errors:

| Code | Name | Description |
|------|------|-------------|
| -32602 | INVALID_PARAMS | Invalid method parameters |
| -32004 | DATA_NOT_FOUND | Requested data not found in cache |
| -32001 | CACHE_MISS | Cache miss for requested tool_call_id |
| -32002 | REFERENCE_NOT_FOUND | No matching reference found for keyword |
| -32003 | RESOLUTION_FAILED | Failed to resolve one or more placeholders |
| -32005 | INSUFFICIENT_PERMISSIONS | Access denied due to permission restrictions |
| -32006 | INVALID_DATA_USAGE | Invalid or unauthorized data usage level |
| -32007 | CONSENT_REQUIRED | User consent required for operation |
| -32008 | CONSENT_DENIED | User denied consent for operation |
| -32009 | CONSENT_TIMEOUT | Consent request timed out |
| -32010 | INVALID_TARGET | Invalid or unsupported target specification |
| -32603 | INTERNAL_ERROR | Server internal error |
| -32601 | METHOD_NOT_FOUND | Requested method not supported |

### Enhanced Error Responses

**Permission Error Example**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32005,
    "message": "Target access denied: llm_not_in_allowlist",
    "data": {
      "validation_details": {
        "data_usage_valid": true,
        "target_permissions_valid": false,
        "consent_check": {
          "consent_required": false,
          "reason": ["target_denied"],
          "trusted_server": false
        }
      },
      "target": {
        "type": "llm",
        "destination": "gpt-4"
      },
      "tool_name": "get_sensitive_data"
    }
  },
  "id": "request_id"
}
```

## Server Implementation Requirements

### 1. Tool Configuration

Each tool exposed by the server must have an associated `dataPolicy` in its definition. This configuration determines how sensitive data from the tool can be accessed and shared.

**Tool Definition Structure**:
```json
{
  "name": "get_customer_data",
  "description": "Retrieves sensitive customer information",
  "isSensitive": true,
  "dataPolicy": {
    "data_usage_permissions": {
      "display": "allow",
      "process": "allow", 
      "store": "prompt",
      "transfer": "prompt"
    },
    "target_permissions": {
      "allowed_targets": ["internal_llm", "analytics_server", "mobile_app"],
      "blocked_targets": ["external_llm", "competitor_api"],
      "allowed_clients": ["dashboard_app", "mobile_app"],
      "allowed_servers": ["analytics_server", "backup_server"],
      "blocked_servers": ["external_api"]
    },
    "consent_overrides": {
      "always_require_consent": false,
      "never_require_consent": false,
      "custom_consent_message": "This will access sensitive customer data. Continue?",
      "allowed_without_consent": ["internal_llm"]
    }
  }
}
```

### 2. Global Server Configuration

The server should maintain a global configuration for default policies, trusted targets, and target categories.

**Server Configuration Structure**:
```json
{
  "global_policies": {
    "default_data_usage_policy": {
      "display": "allow",
      "process": "allow",
      "store": "prompt", 
      "transfer": "prompt"
    },
    "default_target_policy": {
      "client": "allow",
      "server": ["internal_servers"],
      "llm": "prompt",
      "all": "prompt"
    },
    "user_consent_settings": {
      "require_consent_for": {
        "sensitive_data_transfer": true,
        "external_server_transfer": true,
        "cross_domain_transfer": true,
        "llm_data_access": true,
        "any_transfer": false
      },
      "consent_timeout_seconds": 30,
      "default_on_timeout": "deny",
      "cache_consent_duration_minutes": 60,
      "trusted_targets": ["internal_llm", "company_analytics", "mobile_app_v2"],
      "trusted_domains": ["company.com", "internal.local"],
      "show_data_preview": true,
      "show_destination_info": true,
      "allow_remember_choice": true
    },
    "target_categories": {
      "internal_llm": {
        "type": "llm",
        "category": "internal", 
        "trust_level": "high",
        "requires_consent": false,
        "metadata": {
          "provider": "internal",
          "model_type": "local",
          "data_retention": "none",
          "allowed_data_types": ["customer_data", "analytics", "reports"]
        },
        "description": "Internal company LLM for data analysis"
      },
      "gpt-4": {
        "type": "llm",
        "category": "external",
        "trust_level": "medium", 
        "requires_consent": true,
        "metadata": {
          "provider": "openai",
          "model_type": "cloud",
          "data_retention": "temporary",
          "allowed_data_types": ["general", "public_data"]
        },
        "description": "OpenAI GPT-4 external language model"
      },
      "analytics_server": {
        "type": "server",
        "category": "internal",
        "trust_level": "high",
        "requires_consent": false,
        "metadata": {
          "domain": "analytics.company.com"
        },
        "description": "Internal analytics processing server"
      },
      "mobile_app_v2": {
        "type": "client", 
        "category": "internal",
        "trust_level": "high",
        "requires_consent": false,
        "metadata": {
          "application_type": "mobile",
          "platform": "ios_android"
        },
        "description": "Company mobile application v2"
      }
    }
  }
}
```

### 3. Access Control Logic

The server's core responsibility is to enforce access controls. The validation flow follows this hierarchy:

1. **Check Unified Target Controls First**: Look at `allowed_targets` and `blocked_targets` in tool policy
2. **Legacy Fallback**: Use type-specific rules (`allowed_servers`, `allowed_clients`) if no unified rules
3. **Global Policy Check**: Apply server's `global_policies` and `trusted_targets`
4. **Target Category Lookup**: Check `target_categories` for specific policies 
5. **Data Usage Validation**: Ensure requested usage level is permitted (display < process < store < transfer)
6. **LLM-Specific Checks**: Apply data retention and data type policies for LLM targets
7. **Consent Management**: Handle consent requirements based on policies and trust levels

**Access Control Implementation**:
```typescript
function validateDataAccess(
  tool: Tool, 
  usageContext: McppUsageContext, 
  serverConfig: McppServerConfig,
  data: any
): ValidationResult {
  
  // 1. Check unified target permissions first
  if (tool.dataPolicy?.target_permissions?.allowed_targets) {
    const allowedTargets = tool.dataPolicy.target_permissions.allowed_targets;
    if (allowedTargets !== 'all' && !allowedTargets.includes(usageContext.target.destination)) {
      return { allowed: false, error_code: INSUFFICIENT_PERMISSIONS };
    }
  }
  
  // 2. Check blocked targets
  if (tool.dataPolicy?.target_permissions?.blocked_targets?.includes(usageContext.target.destination)) {
    return { allowed: false, error_code: INSUFFICIENT_PERMISSIONS };
  }
  
  // 3. Validate data usage hierarchy
  const requiredLevel = usageContext.data_usage;
  const permission = tool.dataPolicy?.data_usage_permissions?.[requiredLevel];
  
  if (permission === 'deny') {
    return { allowed: false, error_code: INVALID_DATA_USAGE };
  }
  
  if (permission === 'prompt') {
    return { 
      allowed: false, 
      error_code: CONSENT_REQUIRED,
      consent_request: generateConsentRequest(tool, usageContext, data)
    };
  }
  
  // 4. Check target categories and trust levels
  const targetCategory = serverConfig.global_policies.target_categories[usageContext.target.destination];
  if (targetCategory && targetCategory.requires_consent) {
    return {
      allowed: false,
      error_code: CONSENT_REQUIRED, 
      consent_request: generateConsentRequest(tool, usageContext, data)
    };
  }
  
  return { allowed: true };
}
```

### 4. Data Caching Implementation

The server must implement secure caching for tool results:

**Cache Interface**:
```typescript
interface DataCache {
  set(toolCallId: string, data: CachedData): void;
  get(toolCallId: string): CachedData | undefined;
  has(toolCallId: string): boolean;
  delete(toolCallId: string): boolean;
  keys(): string[];
  clear(): void;
}

interface CachedData {
  type: 'table' | 'text' | 'json';
  payload: any;
  metadata: {
    tool_name: string;
    timestamp: number;
    is_sensitive: boolean;
    expires_at?: number;
  };
}
```

**Security Requirements**:
- Encrypt sensitive data at rest
- Implement cache expiration policies
- Clear cache on server restart if containing sensitive data
- Log cache access for audit purposes
- Validate cache integrity

### 5. Consent Management System

Implement asynchronous consent workflows:

**Consent Cache Interface**:
```typescript
interface ConsentCache {
  createConsentRequest(request: ConsentRequest): string; // returns request_id
  resolveConsentRequest(requestId: string, decision: 'allow' | 'deny'): boolean;
  getPendingRequests(): string[];
  cacheConsentDecision(cacheKey: string, decision: 'allow' | 'deny', duration: number): void;
  checkCachedConsent(cacheKey: string): 'allow' | 'deny' | null;
}
```

**Consent Request Generation**:
```typescript
function generateConsentRequest(
  tool: Tool,
  usageContext: McppUsageContext, 
  data: any
): ConsentRequest {
  return {
    request_id: generateUniqueId(),
    tool_name: tool.name,
    data_summary: {
      placeholder_count: countPlaceholders(data),
      data_types: extractDataTypes(data),
      sensitive_fields: identifySensitiveFields(data)
    },
    transfer_details: {
      destination_server: usageContext.target.destination,
      destination_description: getTargetDescription(usageContext.target),
      data_usage: usageContext.data_usage,
      trust_level: getTrustLevel(usageContext.target)
    },
    options: {
      allow_remember: true,
      timeout_seconds: 30,
      show_data_preview: true
    },
    custom_message: tool.dataPolicy?.consent_overrides?.custom_consent_message
  };
}
```

### 6. Placeholder Management

Implement placeholder generation and resolution:

**Placeholder Patterns**:
- Single placeholder: `{tool_call_id.row_index.column_name}`
- Multiple placeholders: `Hello {tool_123.0.Name}, email: {tool_123.0.Email}`
- Regex patterns: `/\{([a-zA-Z0-9_.-]+?)\}/g`

**Resolution Logic**:
```typescript
function resolveSinglePlaceholder(
  placeholder: string, 
  cache: DataCache
): { success: boolean; value: any } {
  
  const parts = placeholder.split('.');
  if (parts.length !== 3) {
    return { success: false, value: null };
  }
  
  const [toolCallId, rowIndex, columnName] = parts;
  const cachedData = cache.get(toolCallId);
  
  if (!cachedData || cachedData.type !== 'table') {
    return { success: false, value: null };
  }
  
  const { headers, rows } = cachedData.payload;
  const colIndex = headers.indexOf(columnName);
  const rowIdx = parseInt(rowIndex);
  
  if (colIndex === -1 || rowIdx >= rows.length) {
    return { success: false, value: null };
  }
  
  return { success: true, value: rows[rowIdx][colIndex] };
}
```

### 7. LLM-Specific Handling

For LLM targets, implement additional validation:

**LLM Validation Logic**:
```typescript
function validateLLMTarget(
  usageContext: McppUsageContext,
  tool: Tool,
  serverConfig: McppServerConfig
): ValidationResult {
  
  if (usageContext.target.type !== 'llm') {
    return { allowed: true };
  }
  
  const llmMetadata = usageContext.target.llm_metadata;
  
  // Check data retention policy
  if (llmMetadata?.data_retention_policy === 'permanent' && tool.isSensitive) {
    return { 
      allowed: false, 
      error_code: INSUFFICIENT_PERMISSIONS,
      message: "Sensitive data cannot be sent to LLMs with permanent data retention"
    };
  }
  
  // Check allowed data types
  const targetCategory = serverConfig.global_policies.target_categories[usageContext.target.destination];
  if (targetCategory?.metadata?.allowed_data_types) {
    const dataTypes = extractDataTypes(tool);
    const hasDisallowedTypes = dataTypes.some(type => 
      !targetCategory.metadata.allowed_data_types.includes(type)
    );
    
    if (hasDisallowedTypes) {
      return {
        allowed: false,
        error_code: INSUFFICIENT_PERMISSIONS,
        message: "Data type not allowed for this LLM target"
      };
    }
  }
  
  return { allowed: true };
}
```

### 8. Error Handling Best Practices

**Security Considerations**:
- Never expose sensitive data in error messages
- Provide generic error messages to clients
- Log detailed errors securely on server side
- Implement proper error recovery mechanisms
- Validate all inputs to prevent injection attacks

**Error Response Format**:
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32005,
    "message": "Access denied",
    "data": {
      "validation_details": {
        "data_usage_valid": true,
        "target_permissions_valid": false
      },
      "help": "Contact administrator for access to this target"
    }
  },
  "id": "request_id"
}
```

### 9. Implementation Checklist

For a complete MCPP server implementation:

- [ ] **Standard MCP Endpoints**: Implement all standard MCP protocol methods
- [ ] **MCPP Extensions**: Add all 4 MCPP-specific endpoints (`get_data`, `find_reference`, `resolve_placeholders`, `provide_consent`)
- [ ] **Tool Configuration**: Support `dataPolicy` in tool definitions
- [ ] **Global Configuration**: Implement server-wide policy configuration
- [ ] **Data Caching**: Secure caching with encryption and expiration
- [ ] **Access Control**: Unified target validation with hierarchy support
- [ ] **Consent Management**: Asynchronous consent workflows with caching
- [ ] **Placeholder System**: Generation and resolution with proper validation
- [ ] **LLM Support**: Special handling for language model targets
- [ ] **Error Handling**: Comprehensive error codes and secure error messages
- [ ] **Logging & Audit**: Security event logging for compliance
- [ ] **Testing**: Unit tests for all MCPP endpoints and validation logic

This comprehensive server guide provides all the necessary specifications to implement a fully compliant MCPP server that can handle privacy-enhanced data workflows while maintaining security and user control over sensitive information.
