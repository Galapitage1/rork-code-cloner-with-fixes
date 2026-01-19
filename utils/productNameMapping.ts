import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@stock_app_product_name_mappings';

export type ProductNameMapping = {
  truncatedName: string;
  fullProductId: string;
  fullProductName: string;
  addedAt: number;
};

export async function getProductNameMappings(): Promise<ProductNameMapping[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveProductNameMapping(
  truncatedName: string,
  productId: string,
  productName: string
): Promise<void> {
  try {
    const existing = await getProductNameMappings();
    const index = existing.findIndex(m => m.truncatedName.toLowerCase() === truncatedName.toLowerCase());
    
    const mapping: ProductNameMapping = {
      truncatedName,
      fullProductId: productId,
      fullProductName: productName,
      addedAt: Date.now(),
    };
    
    if (index >= 0) {
      existing[index] = mapping;
    } else {
      existing.push(mapping);
    }
    
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch {
  }
}

export async function findMappingForTruncatedName(truncatedName: string): Promise<ProductNameMapping | null> {
  const mappings = await getProductNameMappings();
  return mappings.find(m => m.truncatedName.toLowerCase() === truncatedName.toLowerCase()) || null;
}

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function findPossibleMatches(truncatedName: string, products: { id: string; name: string; unit?: string }[]): { id: string; name: string; score: number }[] {
  const lowerTruncated = truncatedName.toLowerCase().trim();
  const normalizedTruncated = normalizeString(truncatedName);
  
  const matches = products
    .map(p => {
      const lowerName = p.name.toLowerCase().trim();
      const normalizedName = normalizeString(p.name);
      let score = 0;
      
      if (lowerName === lowerTruncated || normalizedName === normalizedTruncated) {
        score = 100;
      } else if (lowerName.startsWith(lowerTruncated)) {
        const lengthRatio = lowerTruncated.length / lowerName.length;
        score = 90 + (lengthRatio * 8);
      } else if (lowerTruncated.startsWith(lowerName)) {
        score = 85;
      } else if (normalizedName.startsWith(normalizedTruncated)) {
        const lengthRatio = normalizedTruncated.length / normalizedName.length;
        score = 88 + (lengthRatio * 8);
      } else if (normalizedTruncated.startsWith(normalizedName.substring(0, Math.min(normalizedName.length, normalizedTruncated.length)))) {
        const matchLen = Math.min(normalizedName.length, normalizedTruncated.length);
        const lengthRatio = matchLen / Math.max(normalizedName.length, normalizedTruncated.length);
        score = 80 + (lengthRatio * 10);
      } else if (lowerName.includes(lowerTruncated)) {
        score = 75;
      } else if (lowerTruncated.includes(lowerName)) {
        score = 70;
      } else {
        const truncWords = normalizedTruncated.split(/\s+/).filter(w => w.length > 2);
        const nameWords = normalizedName.split(/\s+/).filter(w => w.length > 2);
        
        let matchedWords = 0;
        let partialMatches = 0;
        
        for (const tw of truncWords) {
          if (nameWords.some(nw => nw === tw)) {
            matchedWords++;
          } else if (nameWords.some(nw => nw.startsWith(tw) || tw.startsWith(nw))) {
            partialMatches++;
          }
        }
        
        if (matchedWords > 0 || partialMatches > 0) {
          const totalWords = Math.max(truncWords.length, 1);
          score = 50 + (matchedWords / totalWords) * 30 + (partialMatches / totalWords) * 15;
        }
        
        if (score < 50 && normalizedTruncated.length >= 5 && normalizedName.length >= 5) {
          const distance = levenshteinDistance(normalizedTruncated, normalizedName);
          const maxLen = Math.max(normalizedTruncated.length, normalizedName.length);
          const similarity = 1 - (distance / maxLen);
          if (similarity > 0.6) {
            score = Math.max(score, 40 + (similarity * 40));
          }
        }
      }
      
      return { id: p.id, name: p.name, score: Math.min(100, score) };
    })
    .filter(m => m.score >= 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  
  return matches;
}

export function findBestMatch(
  truncatedName: string,
  products: { id: string; name: string; unit?: string }[],
  options?: { minAutoMatchScore?: number; unit?: string }
): { match: { id: string; name: string; score: number } | null; needsConfirmation: boolean; possibleMatches: { id: string; name: string; score: number }[] } {
  const minAutoMatchScore = options?.minAutoMatchScore ?? 85;
  
  let filteredProducts = products;
  if (options?.unit) {
    const unitLower = options.unit.toLowerCase().trim();
    filteredProducts = products.filter(p => p.unit?.toLowerCase().trim() === unitLower);
    if (filteredProducts.length === 0) {
      filteredProducts = products;
    }
  }
  
  const possibleMatches = findPossibleMatches(truncatedName, filteredProducts);
  
  if (possibleMatches.length === 0) {
    return { match: null, needsConfirmation: false, possibleMatches: [] };
  }
  
  const bestMatch = possibleMatches[0];
  
  if (bestMatch.score >= minAutoMatchScore) {
    return { match: bestMatch, needsConfirmation: false, possibleMatches };
  }
  
  if (bestMatch.score >= 70) {
    return { match: null, needsConfirmation: true, possibleMatches };
  }
  
  return { match: null, needsConfirmation: true, possibleMatches };
}
