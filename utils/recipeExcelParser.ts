import * as XLSX from 'xlsx';
import { Recipe, Product, ProductConversion } from '@/types';

export interface UnmatchedItem {
  type: 'menu' | 'ingredient';
  originalName: string;
  originalUnit: string;
  forProduct?: string; // For ingredients, the menu product name
  forProductId?: string; // For ingredients, the menu product id
  quantity?: number; // For ingredients
  rowData?: {
    productName: string;
    productUnit: string;
    ingredientName: string;
    quantity: number;
    unit: string;
  };
  possibleMatches: Product[];
}

export interface ParsedRecipeData {
  recipes: Recipe[];
  errors: string[];
  warnings: string[];
  unmatchedItems: UnmatchedItem[];
}

function normalizeUnit(unit: string): string {
  const trimmed = unit.trim();
  if (trimmed.startsWith('1')) {
    return trimmed.substring(1).trim();
  }
  return trimmed;
}

function parseQuantityWithUnit(value: string): { quantity: number; unit: string } {
  const trimmed = value.trim();
  const match = trimmed.match(/^([0-9.]+)\s*(.*)$/);
  if (match) {
    return {
      quantity: parseFloat(match[1]) || 0,
      unit: normalizeUnit(match[2] || '')
    };
  }
  return { quantity: 0, unit: '' };
}

function findClosestMatches(name: string, unit: string, products: Product[], limit: number = 5): Product[] {
  const normalizedName = name.toLowerCase().trim();
  const normalizedUnit = unit.toLowerCase().trim();
  
  const scored = products.map(p => {
    let score = 0;
    const pName = p.name.toLowerCase();
    const pUnit = p.unit.toLowerCase();
    
    // Exact name match
    if (pName === normalizedName) score += 100;
    // Name contains search or vice versa
    else if (pName.includes(normalizedName) || normalizedName.includes(pName)) score += 50;
    // Partial word match
    else {
      const searchWords = normalizedName.split(/\s+/);
      const productWords = pName.split(/\s+/);
      const matchingWords = searchWords.filter(sw => 
        productWords.some(pw => pw.includes(sw) || sw.includes(pw))
      );
      score += matchingWords.length * 20;
    }
    
    // Unit matching bonus
    if (pUnit === normalizedUnit) score += 30;
    else if (pUnit.includes(normalizedUnit) || normalizedUnit.includes(pUnit)) score += 15;
    
    return { product: p, score };
  });
  
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.product);
}

export function parseRecipeExcelFile(
  base64Data: string, 
  existingProducts: Product[], 
  productConversions: ProductConversion[] = [],
  existingRecipes: Recipe[] = []
): ParsedRecipeData {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recipes: Recipe[] = [];
  const unmatchedItems: UnmatchedItem[] = [];

  try {
    const workbook = XLSX.read(base64Data, { type: 'base64' });
    
    if (workbook.SheetNames.length === 0) {
      errors.push('Excel file has no sheets');
      return { recipes: [], errors, warnings };
    }

    const menuProducts = existingProducts.filter(p => p.type === 'menu');
    const rawProducts = existingProducts.filter(p => p.type === 'raw');
    
    const conversionsByFromId = new Map<string, { toProductId: string; factor: number }>();
    productConversions.forEach(conv => {
      conversionsByFromId.set(conv.fromProductId, { toProductId: conv.toProductId, factor: conv.conversionFactor });
    });

    for (const sheetName of workbook.SheetNames) {
      
      const sheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      
      for (let row = 0; row <= range.e.r; row++) {
        const productNameCell = sheet[`A${row + 1}`];
        
        if (!productNameCell || !productNameCell.v || String(productNameCell.v).trim() === '') {
          continue;
        }

        const productName = String(productNameCell.v).trim();
        const productUnitCell = sheet[`B${row + 1}`];
        const productUnit = productUnitCell && productUnitCell.v ? normalizeUnit(String(productUnitCell.v)) : '';

        if (!productUnit) {
          continue;
        }

        const matchedProduct = menuProducts.find(p => 
          p.name.toLowerCase() === productName.toLowerCase() && 
          p.unit.toLowerCase() === productUnit.toLowerCase()
        );
        
        if (!matchedProduct) {
          const possibleMatches = findClosestMatches(productName, productUnit, menuProducts);
          if (possibleMatches.length > 0) {
            // Check if we already have this unmatched item
            const existingUnmatched = unmatchedItems.find(
              u => u.type === 'menu' && u.originalName.toLowerCase() === productName.toLowerCase() && u.originalUnit.toLowerCase() === productUnit.toLowerCase()
            );
            if (!existingUnmatched) {
              unmatchedItems.push({
                type: 'menu',
                originalName: productName,
                originalUnit: productUnit,
                possibleMatches,
              });
              warnings.push(`Product "${productName}" (${productUnit}) - possible match: ${possibleMatches[0].name} (${possibleMatches[0].unit})`);
            }
          }
          continue;
        }

        const existingRecipe = existingRecipes.find(r => r.menuProductId === matchedProduct.id);
        if (existingRecipe) {
          
          continue;
        }

        const ingredientNameCell = sheet[`C${row + 1}`];
        if (!ingredientNameCell || !ingredientNameCell.v) {
          continue;
        }

        const ingredientName = String(ingredientNameCell.v).trim();
        const quantityWithUnitCell = sheet[`D${row + 1}`];
        
        if (!quantityWithUnitCell || !quantityWithUnitCell.v) {
          continue;
        }

        const quantityWithUnit = String(quantityWithUnitCell.v).trim();
        const { quantity, unit } = parseQuantityWithUnit(quantityWithUnit);

        if (quantity <= 0) {
          continue;
        }

        const matchedRaw = rawProducts.find(p => 
          p.name.toLowerCase() === ingredientName.toLowerCase() && 
          p.unit.toLowerCase() === unit.toLowerCase()
        );

        if (!matchedRaw) {
          const possibleMatches = findClosestMatches(ingredientName, unit, rawProducts);
          // Check if we already have this unmatched item for the same product
          const existingUnmatched = unmatchedItems.find(
            u => u.type === 'ingredient' && 
                 u.originalName.toLowerCase() === ingredientName.toLowerCase() && 
                 u.originalUnit.toLowerCase() === unit.toLowerCase() &&
                 u.forProductId === matchedProduct.id
          );
          if (!existingUnmatched) {
            unmatchedItems.push({
              type: 'ingredient',
              originalName: ingredientName,
              originalUnit: unit,
              forProduct: productName,
              forProductId: matchedProduct.id,
              quantity,
              rowData: {
                productName,
                productUnit,
                ingredientName,
                quantity,
                unit,
              },
              possibleMatches,
            });
            if (possibleMatches.length > 0) {
              warnings.push(`Ingredient "${ingredientName}" (${unit}) for ${productName} - possible match: ${possibleMatches[0].name} (${possibleMatches[0].unit})`);
            } else {
              warnings.push(`Ingredient "${ingredientName}" (${unit}) for ${productName} - no matches found`);
            }
          }
          continue;
        }

        const existingRecipeForProduct = recipes.find(r => r.menuProductId === matchedProduct.id);
        if (existingRecipeForProduct) {
          existingRecipeForProduct.components.push({
            rawProductId: matchedRaw.id,
            quantityPerUnit: quantity
          });
        } else {
          const recipe: Recipe = {
            id: `rcp-${matchedProduct.id}`,
            menuProductId: matchedProduct.id,
            components: [{
              rawProductId: matchedRaw.id,
              quantityPerUnit: quantity
            }],
            updatedAt: Date.now()
          };
          recipes.push(recipe);
        }
      }
    }

    const recipesWithConversions: Recipe[] = [];
    for (const recipe of recipes) {
      recipesWithConversions.push(recipe);
      
      
      const conversion = conversionsByFromId.get(recipe.menuProductId);
      if (conversion) {
        const convertedProduct = existingProducts.find(p => p.id === conversion.toProductId);
        if (convertedProduct) {
          const existingConvertedRecipe = existingRecipes.find(r => r.menuProductId === convertedProduct.id);
          if (!existingConvertedRecipe) {
            const convertedComponents = recipe.components.map(comp => ({
              rawProductId: comp.rawProductId,
              quantityPerUnit: comp.quantityPerUnit / conversion.factor
            }));
            
            const convertedRecipe: Recipe = {
              id: `rcp-${convertedProduct.id}`,
              menuProductId: convertedProduct.id,
              components: convertedComponents,
              updatedAt: Date.now()
            };
            recipesWithConversions.push(convertedRecipe);
            
          } else {
            
          }
        }
      }
    }

    if (recipesWithConversions.length === 0 && errors.length === 0) {
      errors.push('No valid recipes found in the Excel file');
    }

  } catch (error) {
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { recipes, errors, warnings, unmatchedItems };
}
