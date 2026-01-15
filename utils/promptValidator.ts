export interface PromptValidationResult {
  readonly isWithinLimit: boolean;
  readonly promptToSend: string;
  readonly originalTokenEstimate: number;
  readonly maxTokens: number;
  readonly wasTruncated: boolean;
  readonly truncationDetails?: string;
}

const TOKEN_ESTIMATE_DIVISOR = 4;
const DEFAULT_MAX_TOKENS = 180000;
const SAFETY_BUFFER = 0.9;

export function estimateTokenCount(text: string): number {
  return Math.ceil((text ?? '').length / TOKEN_ESTIMATE_DIVISOR);
}

export function validatePromptLength(
  prompt: string, 
  maxTokens: number = DEFAULT_MAX_TOKENS
): PromptValidationResult {
  const safePrompt = prompt ?? '';
  const estimatedTokens = estimateTokenCount(safePrompt);
  const safeMaxTokens = Math.floor(maxTokens * SAFETY_BUFFER);

  if (estimatedTokens <= safeMaxTokens) {
    return {
      isWithinLimit: true,
      promptToSend: safePrompt,
      originalTokenEstimate: estimatedTokens,
      maxTokens,
      wasTruncated: false,
    };
  }

  const maxCharacters = safeMaxTokens * TOKEN_ESTIMATE_DIVISOR;
  const truncatedPrompt = smartTruncate(safePrompt, maxCharacters);

  

  return {
    isWithinLimit: false,
    promptToSend: truncatedPrompt,
    originalTokenEstimate: estimatedTokens,
    maxTokens,
    wasTruncated: true,
    truncationDetails: `Reduced from ${estimatedTokens} to ~${estimateTokenCount(truncatedPrompt)} estimated tokens`,
  };
}

function smartTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const isJsonLike = text.trim().startsWith('[') || text.trim().startsWith('{');
  
  if (isJsonLike) {
    return truncateJsonData(text, maxChars);
  }

  const preserveStart = Math.floor(maxChars * 0.7);
  const preserveEnd = Math.floor(maxChars * 0.25);
  const separator = '\n\n... [TRUNCATED - DATA TOO LARGE] ...\n\n';
  
  return text.slice(0, preserveStart) + separator + text.slice(-preserveEnd);
}

function truncateJsonData(jsonText: string, maxChars: number): string {
  try {
    const data = JSON.parse(jsonText);
    
    if (Array.isArray(data)) {
      return truncateArray(data, maxChars);
    } else if (typeof data === 'object' && data !== null) {
      return truncateObject(data, maxChars);
    }
  } catch {
    
  }
  
  return jsonText.slice(0, maxChars - 50) + '\n... [TRUNCATED]';
}

function truncateArray(arr: unknown[], maxChars: number): string {
  const totalItems = arr.length;
  let result = JSON.stringify(arr);
  
  if (result.length <= maxChars) return result;

  let itemsToKeep = Math.min(50, Math.floor(totalItems * 0.1));
  let truncatedArr = arr.slice(0, itemsToKeep);
  result = JSON.stringify(truncatedArr);
  
  while (result.length > maxChars - 100 && itemsToKeep > 5) {
    itemsToKeep = Math.floor(itemsToKeep * 0.5);
    truncatedArr = arr.slice(0, itemsToKeep);
    result = JSON.stringify(truncatedArr);
  }

  const truncationNote = { 
    _truncated: true, 
    _originalCount: totalItems, 
    _keptCount: itemsToKeep 
  };
  
  truncatedArr.push(truncationNote);
  return JSON.stringify(truncatedArr);
}

function truncateObject(obj: Record<string, unknown>, maxChars: number): string {
  const result = JSON.stringify(obj);
  
  if (result.length <= maxChars) return result;

  const keys = Object.keys(obj);
  const priorityKeys = ['id', 'name', 'type', 'date', 'status', 'summary'];
  
  const sortedKeys = keys.sort((a, b) => {
    const aIndex = priorityKeys.indexOf(a.toLowerCase());
    const bIndex = priorityKeys.indexOf(b.toLowerCase());
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return 0;
  });

  const truncatedObj: Record<string, unknown> = {};
  let currentSize = 2;
  
  for (const key of sortedKeys) {
    const value = obj[key];
    let valueStr = JSON.stringify(value);
    
    if (Array.isArray(value) && valueStr.length > 500) {
      const truncated = (value as unknown[]).slice(0, 5);
      valueStr = JSON.stringify(truncated);
      truncatedObj[key] = truncated;
      truncatedObj[`_${key}_truncated`] = { original: (value as unknown[]).length, kept: 5 };
    } else if (valueStr.length > 1000) {
      truncatedObj[key] = '[VALUE_TOO_LARGE]';
    } else {
      truncatedObj[key] = value;
    }
    
    currentSize += key.length + valueStr.length + 4;
    
    if (currentSize > maxChars - 100) {
      truncatedObj._truncatedKeys = keys.length - Object.keys(truncatedObj).length;
      break;
    }
  }

  return JSON.stringify(truncatedObj);
}

export function prepareDataForPrompt<T>(
  data: T[], 
  maxItems: number = 100,
  selectFields?: (item: T) => Partial<T>
): T[] {
  const limited = data.slice(0, maxItems);
  
  if (selectFields) {
    return limited.map(selectFields) as T[];
  }
  
  return limited;
}

export function summarizeData<T extends Record<string, unknown>>(data: T[]): string {
  if (data.length === 0) return 'No data available';
  
  const sample = data.slice(0, 3);
  const keys = Object.keys(data[0] || {});
  
  return JSON.stringify({
    totalCount: data.length,
    fields: keys,
    sampleItems: sample,
  });
}
