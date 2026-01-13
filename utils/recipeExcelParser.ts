import * as XLSX from 'xlsx';
import { Recipe, Product, ProductConversion } from '@/types';

export interface ParsedRecipeData {
  recipes: Recipe[];
  errors: string[];
  warnings: string[];
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

export function parseRecipeExcelFile(
  base64Data: string, 
  existingProducts: Product[], 
  productConversions: ProductConversion[] = [],
  existingRecipes: Recipe[] = []
): ParsedRecipeData {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recipes: Recipe[] = [];

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
      console.log(`[RecipeParser] Processing sheet: ${sheetName}`);
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
          const fuzzyMatch = menuProducts.find(p => 
            p.name.toLowerCase().includes(productName.toLowerCase()) ||
            productName.toLowerCase().includes(p.name.toLowerCase())
          );
          if (fuzzyMatch) {
            warnings.push(`Product "${productName}" (${productUnit}) - possible match: ${fuzzyMatch.name} (${fuzzyMatch.unit})`);
          }
          continue;
        }

        const existingRecipe = existingRecipes.find(r => r.menuProductId === matchedProduct.id);
        if (existingRecipe) {
          console.log(`[RecipeParser] Skipping ${matchedProduct.name} - recipe already exists`);
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
          const fuzzyRawMatch = rawProducts.find(p => 
            p.name.toLowerCase().includes(ingredientName.toLowerCase()) ||
            ingredientName.toLowerCase().includes(p.name.toLowerCase())
          );
          if (fuzzyRawMatch) {
            warnings.push(`Ingredient "${ingredientName}" (${unit}) for ${productName} - possible match: ${fuzzyRawMatch.name} (${fuzzyRawMatch.unit})`);
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
      console.log(`[RecipeParser] Created recipe for product ID ${recipe.menuProductId} with ${recipe.components.length} ingredients`);
      
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
            console.log(`[RecipeParser] Auto-created converted recipe for ${convertedProduct.name} (${convertedProduct.unit}) by dividing by ${conversion.factor}`);
          } else {
            console.log(`[RecipeParser] Skipping converted recipe for ${convertedProduct.name} - recipe already exists`);
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

  return { recipes, errors, warnings };
}
