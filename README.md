# Zoho MCPP Servers

This repository contains Model Context Privacy Protocol (MCPP) server implementations for multiple Zoho services, allowing you to interact with Zoho APIs programmatically through enhanced MCP with advanced privacy controls.

## Available Servers

This workspace includes three MCPP-enabled servers:

1. **Zoho Creator Server** (Port 8000) - Access Zoho Creator applications, forms, and reports
2. **Zoho CRM Server** (Port 8001) - Manage CRM modules, records, and customer data  
3. **Zoho Books Server** (Port 8002) - Handle invoices, contacts, and financial data

## Overview

The Zoho MCPP servers act as bridges between AI assistants that implement the Model Context Protocol (like Claude) and the Zoho APIs. These servers include enhanced privacy features through the Model Context Privacy Protocol (MCPP), providing:

- **🔒 Enhanced Privacy Controls**: Fine-grained data access validation
- **🤖 LLM Target Support**: Specialized policies for Language Model targets
- **🎯 Unified Access Controls**: Consistent framework for all target types
- **👤 Consent Management**: Asynchronous user consent workflows
- **📊 Hierarchical Data Usage**: display < process < store < transfer validation
- **🛡️ Target-Specific Policies**: Customizable policies per target with metadata support

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [npm](https://www.npmjs.com/) (v8 or later)
- Zoho account with API access for the services you want to use
- Git

## Getting Started

### Clone the Repository

```bash
git clone https://github.com/ajay-rg-8583/mcpp-server.git
cd mcpp-server
```

### Install Dependencies

```bash
npm install
``` 

### Configuration

1. Create a `.env` file in the root directory with the following variables (for Creator and CRM servers):

```
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_REDIRECT_URI=http://localhost:3000/oauth/callback
MCP_PORT=8000  # Or 8001 for CRM
ZOHO_ACCOUNTS_DOMAIN=https://accounts.zoho.in
ZOHO_API_DOMAIN=https://zohoapis.in/creator  # Adjust for CRM
```

**Credentials Storage:**

- Each server stores its OAuth tokens and org/account info in a separate credentials file in the project root:
  - `.zoho-creator-credentials.json` (for Creator)
  - `.zoho-crm-credentials.json` (for CRM)
  - `.zoho-books-credentials.json` (for Books)
- These files are created automatically after you authenticate each server.
- You do NOT need to set org IDs or tokens for any server in `.env`.

### Service-Specific Setup

Each server requires specific configuration and scopes:

#### Zoho Creator Server
- Port: 8000  
- Scopes: Creator API access
- See: [Creator documentation](link-to-creator-docs)

#### Zoho CRM Server  
- Port: 8001
- Scopes: `ZohoCRM.modules.ALL`, `ZohoCRM.settings.ALL`, `ZohoCRM.users.ALL`
- API Domain: `https://www.zohoapis.in/crm/v8` (or `.com` for US)

#### Zoho Books Server
- Port: 8002  
- Scopes: `ZohoBooks.fullaccess.ALL`
- API Domain: `https://www.zohoapis.in/books/v3`
- **Credentials**: Uses `.zoho-books-credentials.json` (auto-generated after authentication)
### Authentication

Each server needs to be authenticated separately. This will launch the OAuth flow and save credentials to the appropriate JSON file:

```bash
# Authenticate Creator server (creates .zoho-creator-credentials.json)
node dist/zoho-creator-mcpp-server.js auth

# Authenticate CRM server (creates .zoho-crm-credentials.json)
node dist/zoho-crm-mcpp-server.js auth

# Authenticate Books server (creates .zoho-books-credentials.json)
node dist/zoho-books-mcpp-server.js auth
```

### Start Individual Servers

```bash
# Start Creator server (port 8000)
npm run start:creator

# Start CRM server (port 8001)  
npm run start:crm

# Start Books server (port 8002)
npm run start:books

# Start all servers simultaneously
npm run start:all
```

### VS Code Integration

This workspace includes VS Code tasks for easy server management:

1. Open Command Palette (`Cmd+Shift+P`)
2. Type "Tasks: Run Task"
3. Select from available tasks:
   - **Run Creator Server** - Starts Zoho Creator MCPP server
   - **Run Books Server** - Starts Zoho Books MCPP server
   - Or use the existing CRM server task

### Debug Mode

```bash
# Debug individual servers with inspection
npm run debug:creator  # Port 9229
npm run debug:crm      # Port 9230  
npm run debug:books    # Port 9231
```

## MCPP Protocol Features

### Enhanced Privacy Controls

All servers implement the Model Context Privacy Protocol (MCPP) with:

- **Tool-Level Policies**: Each tool defines its own privacy controls
- **Sensitive Data Handling**: Automatic placeholder generation for sensitive data
- **Access Control Validation**: Fine-grained permissions based on target and usage
- **Consent Management**: User consent workflows for sensitive operations

### Data Usage Hierarchy

The protocol enforces a strict hierarchy:
1. **Display**: Show data to user (least restrictive)
2. **Process**: Use data for computations  
3. **Store**: Persist data somewhere
4. **Transfer**: Send data to external systems (most restrictive)

### Target Types

- **client**: Client applications (dashboards, mobile apps)
- **server**: External servers and APIs
- **llm**: Language models (GPT, Claude, etc.)
- **all**: Wildcard for any target type

### Example Privacy Policy

```typescript
{
  name: "get_books_invoices",
  isSensitive: true,
  dataPolicy: {
    data_usage_permissions: {
      display: 'allow',      // Always allowed
      process: 'allow',      // Processing allowed  
      store: 'prompt',       // Requires consent
      transfer: 'prompt'     // Requires consent
    },
    target_permissions: {
      allowed_targets: ['internal_llm', 'claude-3'],
      blocked_targets: ['gpt-4']
    },
    consent_overrides: {
      custom_consent_message: "This will access sensitive invoice data..."
    }
  }
}
```
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_REDIRECT_URI=http://localhost:3000/oauth/callback
ZOHO_ACCOUNT_OWNER=your_zoho_account_email
MCP_PORT=8000
ZOHO_ACCOUNTS_DOMAIN=https://accounts.zoho.in
ZOHO_API_DOMAIN=https://zohoapis.in/creator
```

Replace `your_client_id` and `your_client_secret` with your Zoho API credentials.

**Important:** 
- `ZOHO_ACCOUNT_OWNER` should be set to your Zoho account email address. This is crucial for API access.
- `ZOHO_ACCOUNTS_DOMAIN` and `ZOHO_API_DOMAIN` are region-specific. Modify them based on your Zoho Creator domain:
  - US: `https://accounts.zoho.com` and `https://zohoapis.com/creator`
  - India: `https://accounts.zoho.in` and `https://zohoapis.in/creator`
  - Europe: `https://accounts.zoho.eu` and `https://zohoapis.eu/creator`
  - Australia: `https://accounts.zoho.com.au` and `https://zohoapis.com.au/creator`
  - Others: Check Zoho documentation for your specific region


2. For Zoho Books, credentials are managed in `.zoho-books-credentials.json` (created automatically after authentication). You do not need to manually edit this file.

### Setting Up Zoho Creator API Access

1. Go to the [Zoho Developer Console](https://api-console.zoho.in/)
2. Create a new client (Server Based-Client) 
3. Set the redirect URI to `http://localhost:3000/oauth/callback`
4. Make a note of the Client ID and Client Secret
5. Add these values to your `.env` file



## Running the Server

### Development Mode

```bash
npm run dev
```

This runs the server using ts-node for development purposes.

### Production Mode

```bash
npm run build
npm run start
```

The build command compiles TypeScript to JavaScript in the `dist` directory, and start runs the compiled code.

### Authentication Flow

When you start the MCP server for the first time:

1. The server will detect that you don't have valid authentication tokens
2. It will initiate the OAuth flow by opening your browser to the Zoho authorization page
    ```bash
        node ./dist/zoho-creator-mcpp-server.js -- auth

        or 

        npm run start -- auth
    ```
3. Copy the URL displayed on the Terminal and navigate,You'll be prompted to log in to your Zoho account and authorize the application
4. After authorization, Zoho will redirect to your callback URL (`http://localhost:3000/oauth/callback`)
5. The server will process the callback, extract the authorization code, and exchange it for access and refresh tokens
6. These tokens will be stored in the corresponding credentials file for future use:
   - `.zoho-creator-credentials.json` for Creator
   - `.zoho-crm-credentials.json` for CRM
   - `.zoho-books-credentials.json` for Books
2a. For Zoho CRM, credentials are managed in `.zoho-crm-credentials.json` (created automatically after authentication). You do not need to manually edit this file.

When you authorize the application, you'll see a screen like this:

![Zoho Creator Authorization Screen](zoho-creator-auth-screen.png)

The application will request permissions to access your Zoho Creator data, including:
- Get the list of dashboard applications
- Get the list of sections or components
- View records in a report
- Add/modify/delete records in Creator applications
- Read form metadata and options

## API Endpoints

The MCP server implements the following Model Context Protocol endpoints:

- `POST /mcp/list_tools`: List available tools for Zoho Creator
- `POST /mcp/call_tool`: Call a specific Zoho Creator tool

Additionally, the server provides:

- OAuth authentication flow for Zoho Creator
- Token refresh mechanism

## Available Tools

The server provides tools to interact with Zoho Creator, including:

- Fetching applications
- Getting forms and reports
- Retrieving, adding, updating, and deleting records
- Getting field metadata

## Authentication Process

The server automatically handles authentication through OAuth 2.0:

1. When first accessing protected endpoints, the server will attempt to use the stored tokens
2. If tokens are expired or missing, the server will initiate the OAuth flow
3. After successful authentication, tokens are saved for future use

![Zoho Creator MPC Authentication Flow](zoho-creator-mcp-auth-flow.png)

## Troubleshooting

### Common Issues

#### Token Expiration

If you encounter authentication errors, your token might be expired. The server should handle token refresh automatically, but you may need to re-authenticate occasionally.

#### API Limits

Be mindful of Zoho Creator API limits. If you encounter rate limit errors, reduce the frequency of your requests.



## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Integration with AI Assistants

### GitHub Copilot

To integrate with GitHub Copilot, add the following configuration to GitHub `settings.json` file:

```json
"zoho-creator-mcp":{        
    "type": "sse",
    "url": "http://localhost:8000/mcp"
},
```

### Claude IDE

To integrate with Claude IDE, add the following configuration to your Claude settings:

```json
"mcp": {
  "providers": {
    "zoho-creator-mcp": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8000/mcp"
      ]
    }
  }
}
```



## Acknowledgments

- [Model Context Protocol](https://github.com/modelcontextprotocol) for the SDK
- [Zoho Creator](https://www.zoho.com/creator/) for the API
