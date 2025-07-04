#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import type { Request, Response } from 'express';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import fetch, { Response as FetchResponse } from 'node-fetch';
import { URLSearchParams, URL } from 'url';
import http from 'http';
import {
    Tool,
    MCPP_ERRORS,
    dataCache,
    convertToTableFormat,
    processDataResponse,
    resolveArgumentPlaceholders,
    handleGetData,
    handleFindReference,
    handleResolvePlaceholders,
    handleProvideConsent,
    validateDataAccess,
    McppUsageContext,
    McppServerConfig
} from '../src/mcpp-core/dist/index.js';
import { defaultMcppConfig } from './mcpp-server-config.js';

// --- Zoho Configuration ---
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_REDIRECT_URI = process.env.ZOHO_REDIRECT_URI || "http://localhost:3000/oauth/callback";
const MCP_PORT = parseInt(process.env.MCP_PORT || "8001");

const ZOHO_ACCOUNTS_DOMAIN = process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.in";
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.in";

const ZOHO_TOKEN_URL = `${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`;
const ZOHO_AUTH_URL = `${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/auth`;
const ZOHO_API_BASE_URL = `${ZOHO_API_DOMAIN}/crm/v8`;

const credentialsPath = process.env.ZOHO_CREDENTIALS_PATH || path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.zoho-crm-credentials.json",
);

interface ZohoCredentials {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  issued_at: number;
}

// --- OAuth2 Authentication Functions ---

function getAuthorizationUrl(scopes: string[]): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: ZOHO_CLIENT_ID!,
    scope: scopes.join(","),
    redirect_uri: ZOHO_REDIRECT_URI,
    access_type: "offline",
    prompt: "consent",
  });
  return `${ZOHO_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code: string): Promise<ZohoCredentials | null> {
  try {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: ZOHO_CLIENT_ID!,
      client_secret: ZOHO_CLIENT_SECRET!,
      redirect_uri: ZOHO_REDIRECT_URI,
      code: code,
    });

    const response = await fetch(ZOHO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!response.ok) {
      console.error("Error exchanging code for tokens:", await response.text());
      return null;
    }
    const tokens = (await response.json()) as any;
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
      issued_at: Math.floor(Date.now() / 1000),
    };
  } catch (error) {
    console.error("Exception during token exchange:", error);
    return null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<ZohoCredentials | null> {
  try {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ZOHO_CLIENT_ID!,
      client_secret: ZOHO_CLIENT_SECRET!,
      refresh_token: refreshToken,
    });

    console.log(`Refreshing access token at URL: ${ZOHO_TOKEN_URL}`);
    const response = await fetch(ZOHO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (!response.ok) {
      console.error("Error refreshing access token:", await response.text());
      return null;
    }
    const tokens = (await response.json()) as any;
    return {
      access_token: tokens.access_token,
      refresh_token: refreshToken,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
      issued_at: Math.floor(Date.now() / 1000),
    };
  } catch (error) {
    console.error("Exception during token refresh:", error);
    return null;
  }
}

function saveCredentials(credentials: ZohoCredentials): void {
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
  console.error(`Credentials saved to ${credentialsPath}`);
}

function loadCredentials(): ZohoCredentials | null {
  if (fs.existsSync(credentialsPath)) {
    const rawData = fs.readFileSync(credentialsPath, "utf-8");
    return JSON.parse(rawData) as ZohoCredentials;
  }
  return null;
}

async function getAccessToken(): Promise<string | null> {
  let credentials = loadCredentials();
  if (!credentials) {
    console.error("Credentials not found. Please run auth flow.");
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (credentials.issued_at + credentials.expires_in < now + 60) {
    console.error("Access token expired or nearing expiry. Refreshing...");
    if (!credentials.refresh_token) {
        console.error("No refresh token available. Please re-authenticate.");
        return null;
    }
    const newCredentials = await refreshAccessToken(credentials.refresh_token);
    if (newCredentials) {
      saveCredentials(newCredentials);
      credentials = newCredentials;
    } else {
      console.error("Failed to refresh access token.");
      return null;
    }
  }
  return credentials.access_token;
}

async function authenticateAndSave() {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
    console.error("ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET environment variables must be set.");
    process.exit(1);
  }

  // Request all necessary scopes for our tools
  const scopes = [
    "ZohoCRM.modules.ALL", 
    "ZohoCRM.settings.ALL", 
    "ZohoCRM.users.ALL"
  ];
  
  const authUrl = getAuthorizationUrl(scopes);
  console.log(`Please open this URL in your browser to authorize:\n${authUrl}`);

  const code = await new Promise<string | null>((resolve, reject) => {
    const redirectUri = new URL(ZOHO_REDIRECT_URI);
    const port = parseInt(redirectUri.port || "80");
    const hostname = redirectUri.hostname;

    const server = http.createServer(async (req, res) => {
      try {
        if (req.url) {
          const requestUrl = new URL(req.url, `http://${hostname}:${port}`);
          if (requestUrl.pathname === redirectUri.pathname) {
            const authCode = requestUrl.searchParams.get("code");
            if (authCode) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Authentication Successful!</h1><p>You can close this window.</p>");
              resolve(authCode);
            } else {
              const error = requestUrl.searchParams.get("error");
              res.writeHead(400, { "Content-Type": "text/html" });
              res.end(`<h1>Authentication Failed</h1><p>Error: ${error || "Unknown error"}. Please try again.</p>`);
              resolve(null);
            }
          } else {
            res.writeHead(404);
            res.end("Not Found");
            resolve(null);
          }
        } else {
          res.writeHead(400);
          res.end("Bad Request");
          resolve(null);
        }
      } catch (e: any) {
        console.error("Error in callback server:", e);
        res.writeHead(500);
        res.end("Internal Server Error");
        resolve(null);
      } finally {
        server.close(() => {
          // console.error("Callback server closed.");
        });
      }
    });

    server.listen(port, hostname, () => {
      console.error(`Listening on ${hostname}:${port} for OAuth callback...`);
    });

    server.on('error', (err) => {
      console.error('Failed to start callback server:', err);
      reject(err);
    });
  });

  if (!code) {
    console.error("Failed to retrieve authorization code from callback.");
    process.exit(1);
  }

  const credentials = await exchangeCodeForTokens(code.trim());
  if (credentials) {
    saveCredentials(credentials);
    console.log("Authentication successful. Credentials saved.");
  } else {
    console.error("Authentication failed during token exchange.");
    process.exit(1);
  }
}

// --- Tool Definitions ---
const ZOHO_TOOLS: Tool[] = [
    {
        name: "get_crm_modules",
        description: "Get all modules in Zoho CRM",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'allow'
            }
        },
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "get_crm_module_fields",
        description: "Get all fields for a module in Zoho CRM",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'allow'
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["module_api_name"], 
            properties: { 
                module_api_name: { type: "string", description: "The API name of the module (e.g., Leads, Contacts)." } 
            } 
        },
    },
    {
        name: "get_crm_module_records",
        description: "Get records from a module in Zoho CRM with specified fields",
        isSensitive: true,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'prompt',
                transfer: 'prompt'
            },
            target_permissions: {
                allowed_targets: ['internal_llm', 'claude-3'], // Allow only trusted targets for sensitive CRM data
                blocked_targets: ['gpt-4'] // Block specific targets for sensitive customer data
            },
            consent_overrides: {
                custom_consent_message: "This operation will access sensitive CRM records. The data may contain personal information including names, emails, and contact details. Do you want to proceed?"
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["module_api_name", "fields"], 
            properties: { 
                module_api_name: { type: "string", description: "The API name of the module to get records from (e.g., Leads, Contacts, Accounts)." },
                fields: { type: "string", description: "Comma-separated list of field API names to retrieve (e.g., 'Last_Name,Email,Record_Status__s,Converted__s,Converted_Date_Time'). This parameter is mandatory." }
            } 
        },
    },
    {
        name: "add_record_in_crm_module",
        description: "Add a record to a module in Zoho CRM",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'prompt' // Adding records might involve external data
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["module_api_name", "data"], 
            properties: { 
                module_api_name: { type: "string", description: "The API name of the module to add a record to." }, 
                data: { type: "object", description: "The record data to add as a JSON object with actual field names. Example: {\"<field1>\": \"<value1>\", \"<field2>\": \"<value2>\"}. Use the actual field API names from the module fields, not placeholder names." } 
            } 
        },
    },
    {
        name: "update_record_in_crm_module",
        description: "Update a record in a module in Zoho CRM",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'prompt' // Updating records might involve external data
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["module_api_name", "record_id", "data"], 
            properties: { 
                module_api_name: { type: "string", description: "The API name of the module." }, 
                record_id: { type: "string", description: "The ID of the record to update." }, 
                data: { type: "object", description: "The data to update as a JSON object with actual field names. Example: {\"<field1>\": \"<value1>\", \"<field2>\": \"<value2>\"}. Use the actual field API names from the module fields, not placeholder names." } 
            } 
        },
    },
    {
        name: "delete_record_in_crm_module",
        description: "Delete a record from a module in Zoho CRM",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'deny' // Deletion operations shouldn't be transferred
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["module_api_name", "record_id"], 
            properties: { 
                module_api_name: { type: "string", description: "The API name of the module." }, 
                record_id: { type: "string", description: "The ID of the record to delete." } 
            } 
        },
    },
];

// --- Logging Middleware ---
function loggingMiddleware(req: Request, res: Response, next: () => void) {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
}

// --- Tool Handling Logic ---
function validateRequiredParameters(args: any, requiredParams: string[]): { isValid: boolean; errorPayload?: any } {
    const missingParams: string[] = [];
    if (!args) {
        return {
            isValid: false,
            errorPayload: {
                type: "error",
                payload: {
                    message: "Missing all required parameters.",
                    missing_parameters: requiredParams,
                },
            }
        };
    }
    for (const param of requiredParams) {
        if (!(param in args) || args[param] === undefined || args[param] === null || args[param] === '') {
            missingParams.push(param);
        }
    }

    if (missingParams.length > 0) {
        return {
            isValid: false,
            errorPayload: {
                type: "error",
                payload: {
                    message: "Missing required parameters.",
                    missing_parameters: missingParams,
                },
            }
        };
    }

    return { isValid: true };
}

async function callToolHandler(request: any) {
  const { name, arguments: args, tool_call_id } = request.params;
  const accessToken = await getAccessToken();

  if (!accessToken) {
    const errorPayload = {
      type: "error",
      payload: {
        message: "Authentication required or failed.",
        details: "Please run the auth flow or check credentials.",
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(errorPayload, null, 2) }],
      isError: true,
    };
  }

  const tool = ZOHO_TOOLS.find(t => t.name === name);

  // --- Placeholder Replacement Logic ---
  const resolvedArgs = await resolveArgumentPlaceholders(args, dataCache);
  // --- End Placeholder Replacement --

  try {
    // Standard API request headers
    const headers = {
      "Authorization": `Zoho-oauthtoken ${accessToken}`,
      "Accept": "application/json",
    };

    // Handle API errors uniformly
    const handleApiError = async (response: FetchResponse) => {
      let errorText = "Unknown error";
      let errorJson: any = null;
      try {
        errorText = await response.text();
        try {
            errorJson = JSON.parse(errorText);
        } catch (e) {
            // Not a json string
        }
      } catch (e: any) {
        errorText = `Failed to get error text: ${e?.message || 'Unknown error'}`;
      }
      console.error(`Error from Zoho API (${response.status}): ${errorText}`);
      const errorPayload = {
        type: "error",
        payload: {
          message: `API Error (${response.status})`,
          details: errorJson || errorText,
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(errorPayload, null, 2) }],
        isError: true,
      };
    };

    if (name === "get_crm_modules") {
      const url = `${ZOHO_API_BASE_URL}/settings/modules`;
      console.log(`Fetching from URL: ${url}`);
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        return await handleApiError(response);
      }
      
      const data = await response.json() as any;
      const standardizedData = convertToTableFormat(data.modules || [], { api_name: 'module_api_name' });
      return processDataResponse(tool, tool_call_id as string, standardizedData, 'modules');
    }
    else if (name === "get_crm_module_fields") {
        const validation = validateRequiredParameters(resolvedArgs, ["module_api_name"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }
  
        const moduleApiName = resolvedArgs.module_api_name as string;
        const url = `${ZOHO_API_BASE_URL}/settings/fields?module=${moduleApiName}`;
        
        console.log(`Fetching from URL: ${url}`);
        const response = await fetch(url, { method: "GET", headers });
  
        if (!response.ok) {
          return await handleApiError(response);
        }
        
        const data = await response.json() as any;
        const standardizedData = convertToTableFormat(data.fields || [], { api_name: 'field_api_name' });
        return processDataResponse(tool, tool_call_id as string, standardizedData, 'fields');
    }
    else if (name === "get_crm_module_records") {
        const validation = validateRequiredParameters(resolvedArgs, ["module_api_name", "fields"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }
  
        const moduleApiName = resolvedArgs.module_api_name as string;
        const fields = resolvedArgs.fields as string;
        const url = `${ZOHO_API_BASE_URL}/${moduleApiName}?fields=${encodeURIComponent(fields)}`;
        
        console.log(`Fetching from URL: ${url}`);
        const response = await fetch(url, { method: "GET", headers });
  
        if (!response.ok) {
          return await handleApiError(response);
        }
        
        const data = await response.json() as any;
        const standardizedData = convertToTableFormat(data.data || []);
        return processDataResponse(tool, tool_call_id as string, standardizedData, 'records');
    }
    else if (name === "add_record_in_crm_module") {
        const validation = validateRequiredParameters(resolvedArgs, ["module_api_name", "data"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }
  
        const { module_api_name: moduleApiName, data } = resolvedArgs;
        const url = `${ZOHO_API_BASE_URL}/${moduleApiName}`;
        
        console.log(`Posting to URL: ${url}`);
        const payload = { data: [data] };
        
        const response = await fetch(url, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
  
        if (!response.ok) {
          return await handleApiError(response);
        }
        
        const responseData = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(responseData, null, 2) }],
        };
    }
    else if (name === "update_record_in_crm_module") {
        const validation = validateRequiredParameters(resolvedArgs, ["module_api_name", "record_id", "data"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }
  
        const { module_api_name: moduleApiName, record_id: recordId, data } = resolvedArgs;
        const url = `${ZOHO_API_BASE_URL}/${moduleApiName}/${recordId}`;
        console.log(`Putting to URL: ${url}`);
        const payload = { data: [data] };
        
        const response = await fetch(url, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
  
        if (!response.ok) {
          return await handleApiError(response);
        }
        
        const responseData = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(responseData, null, 2) }],
        };
    }
    else if (name === "delete_record_in_crm_module") {
        const validation = validateRequiredParameters(resolvedArgs, ["module_api_name", "record_id"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }
  
        const { module_api_name: moduleApiName, record_id: recordId } = resolvedArgs;
        const url = `${ZOHO_API_BASE_URL}/${moduleApiName}/${recordId}`;
        
        console.log(`Deleting from URL: ${url}`);
        const response = await fetch(url, { method: "DELETE", headers });
  
        if (!response.ok) {
          return await handleApiError(response);
        }
        
        const responseData = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(responseData, null, 2) }],
        };
    }

    // Fallback for unknown tool
    const errorPayload = {
      type: "error",
      payload: {
        message: `Tool not found: ${name}`,
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(errorPayload, null, 2) }],
      isError: true,
    };
  } catch (error: any) {
    console.error(`Unhandled error in callToolHandler for tool ${name}:`, error);
    const errorPayload = {
      type: "error",
      payload: {
        message: `Error calling tool ${name}: ${error.message}`,
        stack: error.stack,
      },
    };
    return {
      content: [{ type: "text", text: JSON.stringify(errorPayload, null, 2) }],
      isError: true,
    };
  }
}

// Function to create and configure a new server instance for each request
function getServer() {
  const server = new Server(
    {
      name: "zoho-crm-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {}, // Tools will be populated by ListTools handler
      },
    }
  );

  // Register request handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ZOHO_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    console.log(`[${new Date().toISOString()}] Endpoint: ${request.params.name}, Arguments: ${JSON.stringify(request.params.arguments, null, 2)}`);
    const response = await callToolHandler(request);
    console.log(`[${new Date().toISOString()}] Endpoint Output for ${request.params.name}: ${JSON.stringify(response, null, 2)}`);
    return response;
  });

  return server;
}

// --- Main Execution Logic ---
async function main() {
  if (process.argv.includes("auth")) {
    await authenticateAndSave();
    return; // Exit after auth
  }

  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET) {
    console.error("ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET environment variables are required.");
    console.error("If you need to authenticate, run with the 'auth' argument: npm run dev -- auth");
    
    if (!fs.existsSync(credentialsPath)) {
      console.error(`Credentials file not found at ${credentialsPath}. Please run the 'auth' flow.`);
      process.exit(1);
    }
  }
  
  // Verify credentials work before starting the server
  const initialToken = await getAccessToken();
  if (!initialToken && !process.argv.includes("auth")) {
    console.error("Failed to obtain access token. Please ensure you have authenticated using the 'auth' command or check your credentials file.");
    process.exit(1);
  }

  console.log("Zoho CRM MCP Server starting...");
  
  // Setup Express server
  const app = express();
  app.use(express.json());
  app.use(loggingMiddleware);

  // Handle POST requests for MCP
  app.post('/mcpp', async (req: Request, res: Response) => {
    // --- Model Context Privacy Protocol: Data retrieval endpoint ---
    if (req.body.method === 'mcpp/get_data') {
        console.log(`[${new Date().toISOString()}] Endpoint: mcpp/get_data, Arguments: ${JSON.stringify(req.body.params, null, 2)}`);
        
        // Find the tool if usage_context is provided
        let tool: Tool | undefined;
        if (req.body.params?.usage_context?.tool_name) {
            tool = ZOHO_TOOLS.find(t => t.name === req.body.params.usage_context.tool_name);
        }
        
        const response = handleGetData(req.body.params, req.body.id, tool, defaultMcppConfig);
        if (response.error) {
            const statusCode = response.error.code === MCPP_ERRORS.DATA_NOT_FOUND ? 404 : 400;
            res.status(statusCode).json(response);
        } else {
            res.json(response);
        }
        return;
    }

    // --- Model Context Privacy Protocol: Reference generation endpoint ---
    if (req.body.method === 'mcpp/find_reference') {
        console.log(`[${new Date().toISOString()}] Endpoint: mcpp/find_reference, Arguments: ${JSON.stringify(req.body.params, null, 2)}`);
        const response = handleFindReference(req.body.params, req.body.id);
        
        if (response.error) {
            const statusCode = response.error.code === MCPP_ERRORS.DATA_NOT_FOUND ? 404 : 400;
            res.status(statusCode).json(response);
        } else {
            res.json(response);
        }
        return;
    }

    // --- Model Context Privacy Protocol: Data resolution endpoint ---
    if (req.body.method === 'mcpp/resolve_placeholders') {
        console.log(`[${new Date().toISOString()}] Endpoint: mcpp/resolve_placeholders, Arguments: ${JSON.stringify(req.body.params, null, 2)}`);
        
        // Find the tool if usage_context is provided
        let tool: Tool | undefined;
        if (req.body.params?.usage_context?.tool_name) {
            tool = ZOHO_TOOLS.find(t => t.name === req.body.params.usage_context.tool_name);
        }
        
        const response = await handleResolvePlaceholders(req.body.params, req.body.id, tool, defaultMcppConfig);
        
        if (response.error) {
            const statusCode = response.error.code === MCPP_ERRORS.INTERNAL_ERROR ? 500 : 400;
            res.status(statusCode).json(response);
        } else {
            res.json(response);
            console.log(`[${new Date().toISOString()}] Endpoint Output for mcpp/resolve_placeholders: ${JSON.stringify(response.result, null, 2)}`);
        }
        return;
    }

    // --- Model Context Privacy Protocol: Consent handling endpoint ---
    if (req.body.method === 'mcpp/provide_consent') {
        console.log(`[${new Date().toISOString()}] Endpoint: mcpp/provide_consent, Arguments: ${JSON.stringify(req.body.params, null, 2)}`);
        const response = handleProvideConsent(req.body.params, req.body.id);
        if (response.error) {
            res.status(400).json(response);
        } else {
            res.json(response);
        }
        return;
    }

    // Forward request to the appropriate server instance
    const server = getServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: req.body.id || null,
      });
    }
  });

  const httpServer = app.listen(MCP_PORT, () => {
    console.log(`Server is running on http://localhost:${MCP_PORT}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log("Shutting down server...");
    httpServer.close(() => {
      console.log("Server shut down gracefully.");
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log("Received SIGTERM, shutting down server...");
    httpServer.close(() => {
      console.log("Server shut down gracefully.");
      process.exit(0);
    });
  });
}

main().catch((error) => {
  console.error("Unexpected error in main execution:", error);
  process.exit(1);
});
