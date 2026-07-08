import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check, ExternalLink } from 'lucide-react';

function CopyBox({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="p-3 rounded-md bg-muted text-sm font-mono overflow-x-auto">{text}</pre>
    </div>
  );
}

export function Docs() {
  const gatewayKey = '<YOUR_GATEWAY_API_KEY>';

  // Dynamically detect the server's base URL from the current browser location.
  // This works whether accessed via domain (api.example.com),
  // IP (http://1.2.3.4:4000), or localhost (http://localhost:4000).
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://api.ai.emirhanmamak.com';
  const baseUrl = origin;

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
        <p className="text-muted-foreground">
          How to connect your clients to MiMo API Key Router.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your Router Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-md bg-muted">
            <p className="text-xs text-muted-foreground mb-1">Detected Server</p>
            <p className="text-sm font-mono">{baseUrl}</p>
          </div>
          <CopyBox label="Base URL" text={baseUrl} />
          <CopyBox label="OpenAI Endpoint" text={`${baseUrl}/v1`} />
          <CopyBox label="Anthropic Endpoint" text={baseUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claude Code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">Method 1: Environment Variables</p>
            <p className="text-sm text-muted-foreground mb-3">
              Set these before running Claude Code:
            </p>
            <CopyBox
              label="Shell environment variables"
              text={`export ANTHROPIC_BASE_URL=${baseUrl}
export ANTHROPIC_AUTH_TOKEN=${gatewayKey}
export ANTHROPIC_MODEL=mimo-v2.5-pro
export ANTHROPIC_DEFAULT_SONNET_MODEL=mimo-v2.5-pro
export ANTHROPIC_DEFAULT_OPUS_MODEL=mimo-v2.5-pro
export ANTHROPIC_DEFAULT_HAIKU_MODEL=mimo-v2.5`}
            />
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Method 2: Project settings.json (Recommended)</p>
            <p className="text-sm text-muted-foreground mb-3">
              Create <code>.claude/settings.json</code> in your project root. This persists across sessions.
            </p>
            <CopyBox
              label=".claude/settings.json"
              text={JSON.stringify({
                env: {
                  ANTHROPIC_BASE_URL: baseUrl,
                  ANTHROPIC_AUTH_TOKEN: gatewayKey,
                  ANTHROPIC_MODEL: "mimo-v2.5-pro",
                  ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5-pro",
                  ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
                  ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5"
                }
              }, null, 2)}
            />
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-2">Available Models & Pricing</p>
            <div className="space-y-2 text-sm">
              <div className="p-2 rounded bg-muted flex justify-between">
                <span><code>mimo-v2.5-pro</code> — Advanced chat</span>
                <span className="text-muted-foreground">$0.435/M in · $0.87/M out</span>
              </div>
              <div className="p-2 rounded bg-muted flex justify-between">
                <span><code>mimo-v2.5</code> — General chat</span>
                <span className="text-muted-foreground">$0.14/M in · $0.28/M out</span>
              </div>
              <div className="p-2 rounded bg-muted flex justify-between">
                <span><code>mimo-v2.5-asr</code> — Speech recognition</span>
                <span className="text-muted-foreground">$0.074/h audio</span>
              </div>
              <div className="p-2 rounded bg-muted flex justify-between">
                <span><code>mimo-v2.5-tts</code> — Text-to-speech</span>
                <span className="text-green-500">Free (limited time)</span>
              </div>
              <div className="p-2 rounded bg-muted flex justify-between">
                <span><code>mimo-v2.5-tts-voiceclone</code> — Voice cloning</span>
                <span className="text-green-500">Free (limited time)</span>
              </div>
              <div className="p-2 rounded bg-muted flex justify-between">
                <span><code>mimo-v2.5-tts-voicedesign</code> — Voice design</span>
                <span className="text-green-500">Free (limited time)</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Only public models (toggled in Settings) appear in <code>/v1/models</code>.
              All models can be used directly by ID.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">
            Then start Claude Code normally. It will use your router as the Anthropic endpoint.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open WebUI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Open Open WebUI settings.</li>
            <li>Add a new OpenAI API connection.</li>
            <li>Use these values:</li>
          </ol>
          <CopyBox
            label="Connection settings"
            text={`OpenAI Base URL: ${baseUrl}/v1
API Key: ${gatewayKey}`}
          />
          <p className="text-sm text-muted-foreground">
            Save and refresh the model list. Select <code>mimo-v2.5</code> or <code>mimo-v2.5-pro</code>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generic OpenAI Client</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyBox
            label="cURL example"
            text={`curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer ${gatewayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "mimo-v2.5-pro",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generic Anthropic Client</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyBox
            label="cURL example"
            text={`curl ${baseUrl}/v1/messages \\
  -H "Authorization: Bearer ${gatewayKey}" \\
  -H "Content-Type: application/json" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "mimo-v2.5-pro",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Adding MiMo Keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Before clients can use the router, you must add real MiMo API keys:
          </p>
          <ol className="list-decimal list-inside space-y-2">
            <li>Go to <Link to="/keys" className="text-primary hover:underline">API Keys</Link>.</li>
            <li>Click <strong>Add Key</strong>.</li>
            <li>Enter a label, the real <code>sk-...</code> MiMo key, and a priority (0 = highest).</li>
            <li>Click <strong>Save Key</strong>.</li>
          </ol>
          <p>
            The router will try keys in priority order. If the top key fails, it automatically falls back to the next one.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Need More Help?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Check the full documentation in the repository for setup, security, failover behavior, Coolify deployment, and troubleshooting.
          </p>
          <a
            href="https://github.com/mamakdevtest/MiMo-API-Key-Router/tree/main/docs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-primary hover:underline"
          >
            View full docs on GitHub
            <ExternalLink className="w-4 h-4 ml-1" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
