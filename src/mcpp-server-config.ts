import type { McppServerConfig } from './mcpp-core/index.js';

/**
 * Default MCPP server configuration
 */
export const defaultMcppConfig: McppServerConfig = {
    global_policies: {
        default_data_usage_policy: {
            display: 'allow',
            process: 'allow', 
            store: 'prompt',
            transfer: 'prompt'
        },
        default_target_policy: {
            client: 'allow',
            server: 'all', // Allow all servers by default, can be restricted per tool
            servers: 'all',
            llm: 'prompt', // Require confirmation for LLM access by default
            all: 'prompt'
        },
        user_consent_settings: {
            require_consent_for: {
                sensitive_data_transfer: true,
                external_server_transfer: true,
                cross_domain_transfer: false,
                llm_data_access: true, // Require consent for LLM access
                any_transfer: false
            },
            consent_timeout_seconds: 30,
            default_on_timeout: 'deny',
            cache_consent_duration_minutes: 60,
            trusted_targets: [
                'localhost',
                'internal_analytics',
                'backup_service',
                'internal_llm',           // Internal LLM
                'claude-3',               // Trusted external LLM
                'gpt-3.5-turbo'          // Trusted external LLM
            ],
            trusted_domains: [
                '*.company.com',
                '*.internal'
            ],
            show_data_preview: true,
            show_destination_info: true,
            allow_remember_choice: true
        },
        target_categories: {
            // Server targets
            'analytics_server': {
                type: 'server',
                category: 'internal',
                trust_level: 'high',
                requires_consent: false,
                description: 'Internal Analytics Platform'
            },
            'backup_service': {
                type: 'server',
                category: 'internal',
                trust_level: 'high',
                requires_consent: false,
                description: 'Data Backup Service'
            },
            'partner_crm': {
                type: 'server',
                category: 'partner',
                trust_level: 'medium',
                requires_consent: true,
                description: 'Partner CRM System'
            },
            'external_api': {
                type: 'server',
                category: 'external',
                trust_level: 'low',
                requires_consent: true,
                description: 'External API Service'
            },
            'public_service': {
                type: 'server',
                category: 'public',
                trust_level: 'low',
                requires_consent: true,
                description: 'Public Service API'
            },
            // LLM targets
            'gpt-4': {
                type: 'llm',
                category: 'external',
                trust_level: 'medium',
                requires_consent: true,
                metadata: {
                    provider: 'openai',
                    model_type: 'cloud',
                    data_retention: 'temporary',
                    allowed_data_types: ['public', 'internal']
                },
                description: 'OpenAI GPT-4 Language Model'
            },
            'gpt-3.5-turbo': {
                type: 'llm',
                category: 'external',
                trust_level: 'medium',
                requires_consent: false, // Trusted model
                metadata: {
                    provider: 'openai',
                    model_type: 'cloud',
                    data_retention: 'temporary',
                    allowed_data_types: ['public', 'internal']
                },
                description: 'OpenAI GPT-3.5 Turbo Language Model'
            },
            'claude-3': {
                type: 'llm',
                category: 'external',
                trust_level: 'high',
                requires_consent: false,
                metadata: {
                    provider: 'anthropic',
                    model_type: 'cloud',
                    data_retention: 'none',
                    allowed_data_types: ['public', 'internal', 'sensitive']
                },
                description: 'Anthropic Claude 3 Language Model'
            },
            'internal_llm': {
                type: 'llm',
                category: 'internal',
                trust_level: 'high',
                requires_consent: false,
                metadata: {
                    provider: 'internal',
                    model_type: 'local',
                    data_retention: 'none',
                    allowed_data_types: ['public', 'internal', 'sensitive']
                },
                description: 'Internal Company Language Model'
            },
            'llama-2': {
                type: 'llm',
                category: 'internal',
                trust_level: 'high',
                requires_consent: false,
                metadata: {
                    provider: 'meta',
                    model_type: 'local',
                    data_retention: 'none',
                    allowed_data_types: ['public', 'internal']
                },
                description: 'Meta LLaMA 2 Language Model (Local)'
            }
        }
    }
};
