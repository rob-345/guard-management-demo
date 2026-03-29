import { SwaggerUiClient } from "@/components/docs/swagger-ui-client";

export const dynamic = "force-dynamic";

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">API Documentation</h1>
        <p className="text-muted-foreground">
          Swagger-backed backend reference for the guard management application and the Hikvision
          SDK admin routes.
        </p>
      </div>

      <SwaggerUiClient url="/api/openapi.json" />
    </div>
  );
}
