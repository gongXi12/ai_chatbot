import { config } from '../config/unifiedConfig.js';
import type { CompanionModel } from './model/CompanionModel.js';
import { DeterministicCompanionModel } from './model/DeterministicCompanionModel.js';
import { OpenAICompatibleCompanionModel } from './model/OpenAICompatibleCompanionModel.js';

export function createCompanionModel(): CompanionModel {
  if (config.model.provider === 'openai-compatible') {
    if (!config.model.baseUrl || !config.model.apiKey || !config.model.model) {
      throw new Error(
        'OPENAI_COMPATIBLE_BASE_URL, OPENAI_COMPATIBLE_API_KEY and OPENAI_COMPATIBLE_MODEL are required',
      );
    }

    return new OpenAICompatibleCompanionModel({
      baseUrl: config.model.baseUrl,
      apiKey: config.model.apiKey,
      model: config.model.model,
    });
  }

  return new DeterministicCompanionModel();
}
