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
  } catch (e) {
    console.error('Failed to load product name mappings:', e);
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
    console.log(`Saved product name mapping: "${truncatedName}" -> "${productName}" (${productId})`);
  } catch (e) {
    console.error('Failed to save product name mapping:', e);
  }
}

export async function findMappingForTruncatedName(truncatedName: string): Promise<ProductNameMapping | null> {
  const mappings = await getProductNameMappings();
  return mappings.find(m => m.truncatedName.toLowerCase() === truncatedName.toLowerCase()) || null;
}

export function findPossibleMatches(truncatedName: string, products: { id: string; name: string }[]): { id: string; name: string; score: number }[] {
  const lowerTruncated = truncatedName.toLowerCase().trim();
  
  const matches = products
    .map(p => {
      const lowerName = p.name.toLowerCase();
      let score = 0;
      
      if (lowerName === lowerTruncated) {
        score = 100;
      } else if (lowerName.startsWith(lowerTruncated)) {
        score = 90;
      } else if (lowerTruncated.startsWith(lowerName.substring(0, Math.min(lowerName.length, lowerTruncated.length - 2)))) {
        score = 80;
      } else if (lowerName.includes(lowerTruncated)) {
        score = 70;
      } else if (lowerTruncated.includes(lowerName.substring(0, Math.min(lowerName.length, 10)))) {
        score = 60;
      } else {
        const words = lowerTruncated.split(/\s+/);
        const matchedWords = words.filter(w => lowerName.includes(w)).length;
        if (matchedWords > 0) {
          score = 50 + (matchedWords / words.length) * 20;
        }
      }
      
      return { id: p.id, name: p.name, score };
    })
    .filter(m => m.score > 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  
  return matches;
}
