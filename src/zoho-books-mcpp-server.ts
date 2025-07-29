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
const MCP_PORT = parseInt(process.env.MCP_PORT || "8002");

const ZOHO_ACCOUNTS_DOMAIN = process.env.ZOHO_ACCOUNTS_DOMAIN || "https://accounts.zoho.in";
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.in";

// Hardcoded organization ID for Zoho Books
const ZOHO_BOOKS_ORG_ID = process.env.ZOHO_BOOKS_ORG_ID || "69405692";

const ZOHO_TOKEN_URL = `${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/token`;
const ZOHO_AUTH_URL = `${ZOHO_ACCOUNTS_DOMAIN}/oauth/v2/auth`;
const ZOHO_API_BASE_URL = `${ZOHO_API_DOMAIN}/books/v3`;

const credentialsPath = process.env.ZOHO_CREDENTIALS_PATH || path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.zoho-books-credentials.json",
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

  // Request all necessary scopes for Zoho Books
  const scopes = [
    "ZohoBooks.fullaccess.ALL"
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
        name: "get_books_invoices",
        description: "Get invoices from Zoho Books. Returns invoice details including customer information, amounts, and status.",
        isSensitive: true,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'prompt',
                transfer: 'prompt'
            },
            target_permissions: {
                allowed_targets: ['internal_llm', 'claude-3'], // Allow only trusted targets for sensitive financial data
                blocked_targets: ['gpt-4'] // Block specific targets for sensitive customer financial data
            },
            consent_overrides: {
                custom_consent_message: "This operation will access sensitive invoice data from Zoho Books. The data may contain financial information, customer details, and payment information. Do you want to proceed?"
            }
        },
        inputSchema: { 
            type: "object", 
            properties: { 
                status: { 
                    type: "string", 
                    description: "Filter invoices by status (optional). Values: sent, draft, overdue, paid, void, unpaid, partially_paid, viewed" 
                },
                customer_id: { 
                    type: "string", 
                    description: "Filter invoices by customer ID (optional)" 
                },
                page: { 
                    type: "integer", 
                    description: "Page number for pagination (optional, default: 1)" 
                },
                per_page: { 
                    type: "integer", 
                    description: "Number of records per page (optional, default: 200, max: 200)" 
                }
            } 
        },
    },
    {
        name: "add_books_invoice",
        description: "Create a new invoice in Zoho Books with customer and line item details.",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'prompt' // Creating invoices might involve external data
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["customer_id", "line_items"], 
            properties: { 
                customer_id: { 
                    type: "string", 
                    description: "The customer ID for the invoice" 
                },
                line_items: { 
                    type: "array", 
                    description: "Array of line items for the invoice",
                    items: {
                        type: "object",
                        required: ["item_id", "quantity"],
                        properties: {
                            item_id: { type: "string", description: "ID of the item" },
                            quantity: { type: "number", description: "Quantity of the item" },
                            rate: { type: "number", description: "Rate per unit (optional, will use item's default rate if not provided)" },
                            description: { type: "string", description: "Description for the line item (optional)" }
                        }
                    }
                },
                invoice_number: { 
                    type: "string", 
                    description: "Custom invoice number (optional, auto-generated if not provided)" 
                },
                date: { 
                    type: "string", 
                    description: "Invoice date in YYYY-MM-DD format (optional, defaults to today)" 
                },
                due_date: { 
                    type: "string", 
                    description: "Due date in YYYY-MM-DD format (optional)" 
                },
                notes: { 
                    type: "string", 
                    description: "Notes for the invoice (optional)" 
                },
                terms: { 
                    type: "string", 
                    description: "Terms and conditions (optional)" 
                }
            } 
        },
    },
    {
        name: "update_books_invoice",
        description: "Update an existing invoice in Zoho Books.",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'prompt' // Updating invoices might involve external data
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["invoice_id"], 
            properties: { 
                invoice_id: { 
                    type: "string", 
                    description: "The ID of the invoice to update" 
                },
                customer_id: { 
                    type: "string", 
                    description: "The customer ID for the invoice (optional)" 
                },
                line_items: { 
                    type: "array", 
                    description: "Array of line items for the invoice (optional)",
                    items: {
                        type: "object",
                        properties: {
                            item_id: { type: "string", description: "ID of the item" },
                            quantity: { type: "number", description: "Quantity of the item" },
                            rate: { type: "number", description: "Rate per unit" },
                            description: { type: "string", description: "Description for the line item" }
                        }
                    }
                },
                date: { 
                    type: "string", 
                    description: "Invoice date in YYYY-MM-DD format (optional)" 
                },
                due_date: { 
                    type: "string", 
                    description: "Due date in YYYY-MM-DD format (optional)" 
                },
                notes: { 
                    type: "string", 
                    description: "Notes for the invoice (optional)" 
                },
                terms: { 
                    type: "string", 
                    description: "Terms and conditions (optional)" 
                }
            } 
        },
    },
    {
        name: "get_books_contacts",
        description: "Get contacts/customers from Zoho Books. Returns customer details including contact information and balances.",
        isSensitive: true,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'prompt',
                transfer: 'prompt'
            },
            target_permissions: {
                allowed_targets: ['internal_llm', 'claude-3'], // Allow only trusted targets for sensitive customer data
                blocked_targets: ['gpt-4'] // Block specific targets for sensitive customer data
            },
            consent_overrides: {
                custom_consent_message: "This operation will access sensitive customer contact data from Zoho Books. The data may contain personal information, contact details, and financial balances. Do you want to proceed?"
            }
        },
        inputSchema: { 
            type: "object", 
            properties: { 
                contact_type: { 
                    type: "string", 
                    description: "Filter by contact type (optional). Values: customer, vendor" 
                },
                page: { 
                    type: "integer", 
                    description: "Page number for pagination (optional, default: 1)" 
                },
                per_page: { 
                    type: "integer", 
                    description: "Number of records per page (optional, default: 200, max: 200)" 
                }
            } 
        },
    },
    {
        name: "get_books_items",
        description: "Get items/products from Zoho Books. Returns item details including pricing and inventory information.",
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
            properties: { 
                page: { 
                    type: "integer", 
                    description: "Page number for pagination (optional, default: 1)" 
                },
                per_page: { 
                    type: "integer", 
                    description: "Number of records per page (optional, default: 200, max: 200)" 
                }
            } 
        },
    },
    {
        name: "add_books_item",
        description: "Create a new item/product in Zoho Books.",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'prompt' // Creating items might involve external data
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["name", "rate"], 
            properties: { 
                name: { 
                    type: "string", 
                    description: "Name of the item" 
                },
                rate: { 
                    type: "number", 
                    description: "Rate/price of the item" 
                },
                description: { 
                    type: "string", 
                    description: "Description of the item (optional)" 
                },
                unit: { 
                    type: "string", 
                    description: "Unit of measurement (optional, e.g., 'pcs', 'kg', 'hrs')" 
                },
                sku: { 
                    type: "string", 
                    description: "Stock Keeping Unit (optional)" 
                },
                account_id: { 
                    type: "string", 
                    description: "Account ID for the item (optional)" 
                },
                tax_id: { 
                    type: "string", 
                    description: "Tax ID for the item (optional)" 
                },
                item_type: { 
                    type: "string", 
                    description: "Type of item (optional). Values: inventory, non_inventory, service" 
                }
            } 
        },
    },
    {
        name: "add_books_payment",
        description: "Record a payment received from a customer in Zoho Books. This can be applied to specific invoices.",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'prompt' // Payment creation might involve external data
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["customer_id", "amount","pyament_mode","invoices","date"], 
            properties: { 
                customer_id: { 
                    type: "string", 
                    description: "The customer ID for the payment" 
                },
                amount: { 
                    type: "number", 
                    description: "Payment amount" 
                },
                payment_mode: { 
                    type: "string", 
                    description: "Payment mode. Values: cash, check, card, bank_transfer, paypal, stripe, etc." 
                },
                date: { 
                    type: "string", 
                    description: "Payment date in YYYY-MM-DD format"// (optional, defaults to today)" 
                },
                reference_number: { 
                    type: "string", 
                    description: "Reference number for the payment (optional)" 
                },
                description: { 
                    type: "string", 
                    description: "Description or notes for the payment (optional)" 
                },
                invoices: { 
                    type: "array", 
                    description: "Array of invoices to apply this payment to",
                    items: {
                        type: "object",
                        properties: {
                            invoice_id: { type: "string", description: "ID of the invoice" },
                            amount_applied: { type: "number", description: "Amount to apply to this invoice" }
                        }
                    }
                },
                account_id: { 
                    type: "string", 
                    description: "Account ID where payment is deposited (optional)" 
                }
            } 
        },
    },
    {
        name: "get_books_payments",
        description: "Get payment records from Zoho Books. Returns payment details including customer information, amounts, and status.",
        isSensitive: true,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'prompt',
                transfer: 'prompt'
            },
            target_permissions: {
                allowed_targets: ['internal_llm', 'claude-3'], // Allow only trusted targets for sensitive financial data
                blocked_targets: ['gpt-4'] // Block specific targets for sensitive payment data
            },
            consent_overrides: {
                custom_consent_message: "This operation will access sensitive payment data from Zoho Books. The data may contain financial information, customer details, and payment information. Do you want to proceed?"
            }
        },
        inputSchema: { 
            type: "object", 
            properties: { 
                customer_id: { 
                    type: "string", 
                    description: "Filter payments by customer ID (optional)" 
                },
                payment_mode: { 
                    type: "string", 
                    description: "Filter by payment mode (optional). Values: cash, check, card, bank_transfer, paypal, stripe, etc." 
                },
                date_start: { 
                    type: "string", 
                    description: "Start date for filtering payments in YYYY-MM-DD format (optional)" 
                },
                date_end: { 
                    type: "string", 
                    description: "End date for filtering payments in YYYY-MM-DD format (optional)" 
                },
                page: { 
                    type: "integer", 
                    description: "Page number for pagination (optional, default: 1)" 
                },
                per_page: { 
                    type: "integer", 
                    description: "Number of records per page (optional, default: 200, max: 200)" 
                }
            } 
        },
    },
    {
        name: "update_books_payment",
        description: "Update an existing payment record in Zoho Books.",
        isSensitive: false,
        dataPolicy: {
            data_usage_permissions: {
                display: 'allow',
                process: 'allow',
                store: 'allow',
                transfer: 'prompt' // Updating payments might involve external data
            }
        },
        inputSchema: { 
            type: "object", 
            required: ["payment_id"], 
            properties: { 
                payment_id: { 
                    type: "string", 
                    description: "The ID of the payment to update" 
                },
                amount: { 
                    type: "number", 
                    description: "Payment amount (optional)" 
                },
                payment_mode: { 
                    type: "string", 
                    description: "Payment mode (optional). Values: cash, check, card, bank_transfer, paypal, stripe, etc." 
                },
                date: { 
                    type: "string", 
                    description: "Payment date in YYYY-MM-DD format (optional)" 
                },
                reference_number: { 
                    type: "string", 
                    description: "Reference number for the payment (optional)" 
                },
                description: { 
                    type: "string", 
                    description: "Description or notes for the payment (optional)" 
                },
                account_id: { 
                    type: "string", 
                    description: "Account ID where payment is deposited (optional)" 
                }
            } 
        },
    },
    {
        name: "delete_books_payment",
        description: "Delete a payment record from Zoho Books.",
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
            required: ["payment_id"], 
            properties: { 
                payment_id: { 
                    type: "string", 
                    description: "The ID of the payment to delete" 
                }
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

  if (!ZOHO_BOOKS_ORG_ID) {
    const errorPayload = {
      type: "error",
      payload: {
        message: "Organization ID not configured.",
        details: "Please set ZOHO_BOOKS_ORG_ID environment variable with your Zoho Books organization ID.",
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
      console.error(`Error from Zoho Books API (${response.status}): ${errorText}`);
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

    if (name === "get_books_invoices") {
      let url = `${ZOHO_API_BASE_URL}/invoices?organization_id=${ZOHO_BOOKS_ORG_ID}`;
      
      // Add query parameters if provided
      const queryParams = [];
      if (resolvedArgs.status) {
        queryParams.push(`status=${encodeURIComponent(resolvedArgs.status)}`);
      }
      if (resolvedArgs.customer_id) {
        queryParams.push(`customer_id=${encodeURIComponent(resolvedArgs.customer_id)}`);
      }
      if (resolvedArgs.page) {
        queryParams.push(`page=${resolvedArgs.page}`);
      }
      if (resolvedArgs.per_page) {
        queryParams.push(`per_page=${resolvedArgs.per_page}`);
      }
      
      if (queryParams.length > 0) {
        url += `&${queryParams.join('&')}`;
      }

      console.log(`Fetching from URL: ${url}`);
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        return await handleApiError(response);
      }
      
      const data = await response.json() as any;
      const standardizedData = convertToTableFormat(data.invoices || []);
      return processDataResponse(tool, tool_call_id as string, standardizedData, 'invoices');
    }
    else if (name === "add_books_invoice") {
        const validation = validateRequiredParameters(resolvedArgs, ["customer_id", "line_items"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }

        const { customer_id, line_items, invoice_number, date, due_date, notes, terms } = resolvedArgs;
        const url = `${ZOHO_API_BASE_URL}/invoices?organization_id=${ZOHO_BOOKS_ORG_ID}`;
        
        const payload: any = {
          customer_id,
          line_items
        };

        if (invoice_number) payload.invoice_number = invoice_number;
        if (date) payload.date = date;
        if (due_date) payload.due_date = due_date;
        if (notes) payload.notes = notes;
        if (terms) payload.terms = terms;

        console.log(`Posting to URL: ${url}`);
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
    else if (name === "update_books_invoice") {
        const validation = validateRequiredParameters(resolvedArgs, ["invoice_id"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }

        const { invoice_id, customer_id, line_items, date, due_date, notes, terms } = resolvedArgs;
        const url = `${ZOHO_API_BASE_URL}/invoices/${invoice_id}?organization_id=${ZOHO_BOOKS_ORG_ID}`;
        
        const payload: any = {};
        if (customer_id) payload.customer_id = customer_id;
        if (line_items) payload.line_items = line_items;
        if (date) payload.date = date;
        if (due_date) payload.due_date = due_date;
        if (notes) payload.notes = notes;
        if (terms) payload.terms = terms;

        console.log(`Putting to URL: ${url}`);
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
    else if (name === "get_books_contacts") {
      let url = `${ZOHO_API_BASE_URL}/contacts?organization_id=${ZOHO_BOOKS_ORG_ID}`;
      
      // Add query parameters if provided
      const queryParams = [];
      if (resolvedArgs.contact_type) {
        queryParams.push(`contact_type=${encodeURIComponent(resolvedArgs.contact_type)}`);
      }
      if (resolvedArgs.page) {
        queryParams.push(`page=${resolvedArgs.page}`);
      }
      if (resolvedArgs.per_page) {
        queryParams.push(`per_page=${resolvedArgs.per_page}`);
      }
      
      if (queryParams.length > 0) {
        url += `&${queryParams.join('&')}`;
      }

      console.log(`Fetching from URL: ${url}`);
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        return await handleApiError(response);
      }
      
      const data = await response.json() as any;
      const standardizedData = convertToTableFormat(data.contacts || []);
      return processDataResponse(tool, tool_call_id as string, standardizedData, 'contacts');
    }
    else if (name === "get_books_items") {
      let url = `${ZOHO_API_BASE_URL}/items?organization_id=${ZOHO_BOOKS_ORG_ID}`;
      
      // Add query parameters if provided
      const queryParams = [];
      if (resolvedArgs.page) {
        queryParams.push(`page=${resolvedArgs.page}`);
      }
      if (resolvedArgs.per_page) {
        queryParams.push(`per_page=${resolvedArgs.per_page}`);
      }
      
      if (queryParams.length > 0) {
        url += `&${queryParams.join('&')}`;
      }

      console.log(`Fetching from URL: ${url}`);
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        return await handleApiError(response);
      }
      
      const data = await response.json() as any;
      const standardizedData = convertToTableFormat(data.items || []);
      return processDataResponse(tool, tool_call_id as string, standardizedData, 'items');
    }
    else if (name === "add_books_item") {
        const validation = validateRequiredParameters(resolvedArgs, ["name", "rate"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }

        const { name: itemName, rate, description, unit, sku, account_id, tax_id, item_type } = resolvedArgs;
        const url = `${ZOHO_API_BASE_URL}/items?organization_id=${ZOHO_BOOKS_ORG_ID}`;
        
        const payload: any = {
          name: itemName,
          rate
        };

        if (description) payload.description = description;
        if (unit) payload.unit = unit;
        if (sku) payload.sku = sku;
        if (account_id) payload.account_id = account_id;
        if (tax_id) payload.tax_id = tax_id;
        if (item_type) payload.item_type = item_type;

        console.log(`Posting to URL: ${url}`);
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
    else if (name === "add_books_payment") {
        const validation = validateRequiredParameters(resolvedArgs, ["customer_id", "amount"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }

        const { customer_id, amount, payment_mode, date, reference_number, description, invoices, account_id } = resolvedArgs;
        const url = `${ZOHO_API_BASE_URL}/customerpayments?organization_id=${ZOHO_BOOKS_ORG_ID}`;
        
        const payload: any = {
          customer_id,
          amount
        };

        if (payment_mode) payload.payment_mode = payment_mode;
        if (date) payload.date = date;
        if (reference_number) payload.reference_number = reference_number;
        if (description) payload.description = description;
        if (invoices) payload.invoices = invoices;
        if (account_id) payload.account_id = account_id;

        console.log(`Posting to URL: ${url}`);
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
    else if (name === "get_books_payments") {
      let url = `${ZOHO_API_BASE_URL}/customerpayments?organization_id=${ZOHO_BOOKS_ORG_ID}`;
      
      // Add query parameters if provided
      const queryParams = [];
      if (resolvedArgs.customer_id) {
        queryParams.push(`customer_id=${encodeURIComponent(resolvedArgs.customer_id)}`);
      }
      if (resolvedArgs.payment_mode) {
        queryParams.push(`payment_mode=${encodeURIComponent(resolvedArgs.payment_mode)}`);
      }
      if (resolvedArgs.date_start) {
        queryParams.push(`date_start=${encodeURIComponent(resolvedArgs.date_start)}`);
      }
      if (resolvedArgs.date_end) {
        queryParams.push(`date_end=${encodeURIComponent(resolvedArgs.date_end)}`);
      }
      if (resolvedArgs.page) {
        queryParams.push(`page=${resolvedArgs.page}`);
      }
      if (resolvedArgs.per_page) {
        queryParams.push(`per_page=${resolvedArgs.per_page}`);
      }
      
      if (queryParams.length > 0) {
        url += `&${queryParams.join('&')}`;
      }

      console.log(`Fetching from URL: ${url}`);
      const response = await fetch(url, { method: "GET", headers });

      if (!response.ok) {
        return await handleApiError(response);
      }
      
      const data = await response.json() as any;
      const standardizedData = convertToTableFormat(data.customerpayments || []);
      return processDataResponse(tool, tool_call_id as string, standardizedData, 'payments');
    }
    else if (name === "update_books_payment") {
        const validation = validateRequiredParameters(resolvedArgs, ["payment_id"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }

        const { payment_id, amount, payment_mode, date, reference_number, description, account_id } = resolvedArgs;
        const url = `${ZOHO_API_BASE_URL}/customerpayments/${payment_id}?organization_id=${ZOHO_BOOKS_ORG_ID}`;
        
        const payload: any = {};
        if (amount) payload.amount = amount;
        if (payment_mode) payload.payment_mode = payment_mode;
        if (date) payload.date = date;
        if (reference_number) payload.reference_number = reference_number;
        if (description) payload.description = description;
        if (account_id) payload.account_id = account_id;

        console.log(`Putting to URL: ${url}`);
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
    else if (name === "delete_books_payment") {
        const validation = validateRequiredParameters(resolvedArgs, ["payment_id"]);
        if (!validation.isValid) {
          return {
              content: [{ type: "text", text: JSON.stringify(validation.errorPayload, null, 2) }],
              isError: true,
          };
        }

        const { payment_id } = resolvedArgs;
        const url = `${ZOHO_API_BASE_URL}/customerpayments/${payment_id}?organization_id=${ZOHO_BOOKS_ORG_ID}`;

        console.log(`Deleting from URL: ${url}`);
        const response = await fetch(url, {
          method: "DELETE",
          headers,
        });

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
      name: "zoho-books-mcp-server",
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

  if (!ZOHO_BOOKS_ORG_ID) {
    console.error("ZOHO_BOOKS_ORG_ID environment variable is required and must be set to your Zoho Books organization ID.");
    process.exit(1);
  }
  
  // Verify credentials work before starting the server
  const initialToken = await getAccessToken();
  if (!initialToken && !process.argv.includes("auth")) {
    console.error("Failed to obtain access token. Please ensure you have authenticated using the 'auth' command or check your credentials file.");
    process.exit(1);
  }

  console.log("Zoho Books MCP Server starting...");
  console.log(`Using Organization ID: ${ZOHO_BOOKS_ORG_ID}`);
  
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
        const statusCode = response.error ? (response.error.code === MCPP_ERRORS.DATA_NOT_FOUND ? 404 : 400) : 200;
        res.status(statusCode).json(response);
        return;
    }

    // --- Model Context Privacy Protocol: Reference generation endpoint ---
    if (req.body.method === 'mcpp/find_reference') {
        console.log(`[${new Date().toISOString()}] Endpoint: mcpp/find_reference, Arguments: ${JSON.stringify(req.body.params, null, 2)}`);
        const response = handleFindReference(req.body.params, req.body.id);
        const statusCode = response.error ? (response.error.code === MCPP_ERRORS.DATA_NOT_FOUND ? 404 : 400) : 200;
        res.status(statusCode).json(response);
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
        const statusCode = response.error ? (response.error.code === MCPP_ERRORS.INTERNAL_ERROR ? 500 : 400) : 200;
        res.status(statusCode).json(response);
        if (!response.error) {
            console.log(`[${new Date().toISOString()}] Endpoint Output for mcpp/resolve_placeholders: ${JSON.stringify(response.result, null, 2)}`);
        }
        return;
    }

    // --- Model Context Privacy Protocol: Consent handling endpoint ---
    if (req.body.method === 'mcpp/provide_consent') {
        console.log(`[${new Date().toISOString()}] Endpoint: mcpp/provide_consent, Arguments: ${JSON.stringify(req.body.params, null, 2)}`);
        const response = handleProvideConsent(req.body.params, req.body.id);
        const statusCode = response.error ? 400 : 200;
        res.status(statusCode).json(response);
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
