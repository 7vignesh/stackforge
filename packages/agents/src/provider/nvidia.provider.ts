import type { LLMProvider, ProviderCallInput, ProviderCallOutput } from "./provider.interface.js";
import {
  OpenRouterProvider,
  type OpenRouterProviderOptions,
} from "./openrouter.provider.js";

export type NvidiaProviderOptions = {
  apiKey?: string;
  apiKeys?: string[];
  model: string;
  endpoint?: string;
  appName?: string;
  appUrl?: string;
};

export class NvidiaProvider implements LLMProvider {
  readonly name = "nvidia";
  private readonly delegate: OpenRouterProvider;
  private readonly model: string;

  constructor(options: NvidiaProviderOptions) {
    const openRouterCompatible: OpenRouterProviderOptions = {
      endpoint: options.endpoint ?? "https://integrate.api.nvidia.com/v1/chat/completions",
      appName: options.appName ?? "stackforge-codegen",
      appUrl: options.appUrl ?? "http://localhost",
    };

    if (Array.isArray(options.apiKeys)) {
      openRouterCompatible.apiKeys = options.apiKeys;
    }

    if (options.apiKey !== undefined) {
      openRouterCompatible.apiKey = options.apiKey;
    }

    this.delegate = new OpenRouterProvider(openRouterCompatible);
    this.model = options.model;
  }

  call(input: ProviderCallInput): Promise<ProviderCallOutput> {
    return this.delegate.call({
      ...input,
      options: {
        ...input.options,
        model: this.model,
      },
    });
  }
}
