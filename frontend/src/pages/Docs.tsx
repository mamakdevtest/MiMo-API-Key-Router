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
  const routerKey = '<YOUR_ROUTER_KEY>';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://api.ai.emirhanmamak.com';
  const baseUrl = origin;

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
        <p className="text-muted-foreground">How the simplified provider-prefixed router works with OpenAI-compatible and Anthropic-compatible clients.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Router Basics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>Clients only receive one router key. Real MiMo or Featherless provider keys never leave the server.</p>
          <p>Each synced model is exposed with a prefixed public ID like <code>mimo-main/mimo-v2.5-pro</code> or <code>featherless-main/meta-llama/...</code>.</p>
          <p>When a request comes in, the router reads the public model ID, finds the owning provider, picks a healthy key from that provider's own key pool, and forwards the request upstream.</p>
          <CopyBox label="Base URL" text={baseUrl} />
          <CopyBox label="OpenAI Base URL" text={`${baseUrl}/v1`} />
          <CopyBox label="Anthropic Base URL" text={baseUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider Setup Flow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>Create a provider from <Link to="/providers" className="text-primary hover:underline">Providers</Link>.</li>
            <li>Open that provider and add its real upstream API keys.</li>
            <li>Use <strong>Test</strong> to validate a provider key.</li>
            <li>Use <strong>Sync Models</strong> to load that provider's models into the catalog.</li>
            <li>Open <Link to="/model-catalog" className="text-primary hover:underline">Model Catalog</Link> and copy the prefixed public model IDs.</li>
            <li>Open <Link to="/keys" className="text-primary hover:underline">Router Keys</Link> to confirm the deployment-managed permanent key, then give only that key to clients.</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claude Code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <CopyBox
            label="Shell environment variables"
            text={`export ANTHROPIC_BASE_URL=${baseUrl}
export ANTHROPIC_AUTH_TOKEN=${routerKey}
export ANTHROPIC_MODEL=mimo-main/mimo-v2.5-pro`}
          />

          <CopyBox
            label=".claude/settings.json"
            text={JSON.stringify({
              env: {
                ANTHROPIC_BASE_URL: baseUrl,
                ANTHROPIC_AUTH_TOKEN: routerKey,
                ANTHROPIC_MODEL: 'mimo-main/mimo-v2.5-pro',
              }
            }, null, 2)}
          />

          <p className="text-sm text-muted-foreground">Anthropic-compatible requests go to <code>/v1/messages</code>, and the router forwards them to the provider that owns the requested prefixed model.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open WebUI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyBox label="Connection settings" text={`OpenAI Base URL: ${baseUrl}/v1
API Key: ${routerKey}`} />
          <p className="text-sm text-muted-foreground">After saving, refresh the model list and choose one of the prefixed model IDs from <code>/v1/models</code>.</p>
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
  -H "Authorization: Bearer ${routerKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "mimo-main/mimo-v2.5-pro",
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
  -H "Authorization: Bearer ${routerKey}" \\
  -H "Content-Type: application/json" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "mimo-main/mimo-v2.5-pro",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Router Keys vs Provider Keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p><strong>Router key:</strong> the client-facing key used by Open WebUI, Claude Code, temp-mail flows, and other integrations.</p>
          <p><strong>Provider keys:</strong> the real upstream keys stored only inside each provider record. They are health-checked, disabled, cooled down, or failed over per provider.</p>
          <p><strong>Router key:</strong> clients use the single deployment-managed <code>GATEWAY_KEY</code>. Provider credentials are never returned by the dashboard or gateway.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Need More Help?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>Check the repository docs for deployment, security, and troubleshooting details. This page focuses on the new simplified provider-prefixed routing flow.</p>
          <a
            href="https://github.com/mamakdevtest/API-Router/tree/main/docs"
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
