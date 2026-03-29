"use client";

import dynamic from "next/dynamic";

import "swagger-ui-react/swagger-ui.css";

const SwaggerUI = dynamic(() => import("swagger-ui-react"), {
  ssr: false,
});

export function SwaggerUiClient({ url }: { url: string }) {
  return (
    <div className="overflow-hidden rounded-3xl border bg-background">
      <SwaggerUI url={url} docExpansion="list" defaultModelsExpandDepth={1} />
    </div>
  );
}
