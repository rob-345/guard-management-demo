declare module "swagger-ui-react" {
  import type { ComponentType } from "react";

  type SwaggerUiProps = {
    url?: string;
    spec?: Record<string, unknown>;
    docExpansion?: "list" | "full" | "none";
    defaultModelsExpandDepth?: number;
  };

  const SwaggerUI: ComponentType<SwaggerUiProps>;
  export default SwaggerUI;
}
