import * as XLSX from 'xlsx';
import { Recipe, Product, ProductConversion } from '@/types';

export interface PendingIngredient {
  ingredientName: string;
  quantity: number;
  unit: string;
  sheetName: string;
}

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
  pendingIngredients?: PendingIngredient[]; // For menu items, the ingredients to be added after matching
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
      return { recipes: [], errors, warnings, unmatchedItems: [] };
    }

    const menuProducts = existingProducts.filter(p => p.type === 'menu');
    const rawProducts = existingProducts.filter(p => p.type === 'raw');
    
    const conversionsByFromId = new Map<string, { toProductId: string; factor: number }>();
    productConversions.forEach(conv => {
      conversionsByFromId.set(conv.fromProductId, { toProductId: conv.toProductId, factor: conv.conversionFactor });
    });

    // Structure to hold pending ingredients for unmatched menu products
    // Key: "originalMenuName|originalMenuUnit", Value: array of ingredients
    const pendingIngredientsForUnmatchedMenu = new Map<string, Array<{
      ingredientName: string;
      quantity: number;
      unit: string;
      sheetName: string;
    }>>();

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
        
        // Column B: Ingredient name
        const ingredientNameCell = sheet[`B${row + 1}`];
        if (!ingredientNameCell || !ingredientNameCell.v) {
          continue;
        }
        const ingredientName = String(ingredientNameCell.v).trim();
        
        // Column C: Quantity and unit mixed together
        const quantityWithUnitCell = sheet[`C${row + 1}`];
        if (!quantityWithUnitCell || !quantityWithUnitCell.v) {
          continue;
        }
        const quantityWithUnit = String(quantityWithUnitCell.v).trim();
        const { quantity, unit } = parseQuantityWithUnit(quantityWithUnit);

        if (quantity <= 0) {
          console.log(`[RecipeParser] Skipping row ${row + 1} - invalid quantity: ${quantityWithUnit}`);
          continue;
        }

        // Try to match menu product by name only (more flexible matching)
        let matchedProduct = menuProducts.find(p => 
          p.name.toLowerCase() === productName.toLowerCase()
        );
        
        // If no exact match, try partial match
        if (!matchedProduct) {
          matchedProduct = menuProducts.find(p => 
            p.name.toLowerCase().includes(productName.toLowerCase()) ||
            productName.toLowerCase().includes(p.name.toLowerCase())
          );
        }
        
        if (!matchedProduct) {
          // Menu product not found - add to unmatched
          const possibleMatches = findClosestMatches(productName, '', menuProducts);
          const menuKey = `${productName.toLowerCase()}`;
          
          // Check if we already have this unmatched menu item
          const existingUnmatched = unmatchedItems.find(
            u => u.type === 'menu' && u.originalName.toLowerCase() === productName.toLowerCase()
          );
          
          if (!existingUnmatched) {
            unmatchedItems.push({
              type: 'menu',
              originalName: productName,
              originalUnit: '', // We don't have unit info in column A anymore
              possibleMatches,
            });
            if (possibleMatches.length > 0) {
              warnings.push(`Menu product "${productName}" - possible match: ${possibleMatches[0].name}`);
            } else {
              warnings.push(`Menu product "${productName}" - no matches found in system`);
            }
          }
          
          // Store the ingredient for this unmatched menu product
          const pendingKey = productName.toLowerCase();
          if (!pendingIngredientsForUnmatchedMenu.has(pendingKey)) {
            pendingIngredientsForUnmatchedMenu.set(pendingKey, []);
          }
          pendingIngredientsForUnmatchedMenu.get(pendingKey)!.push({
            ingredientName,
            quantity,
            unit,
            sheetName,
          });
          
          continue;
        }

        // Menu product matched - now process the ingredient
        const existingRecipe = existingRecipes.find(r => r.menuProductId === matchedProduct!.id);
        
        // Try to match raw product
        let matchedRaw = rawProducts.find(p => 
          p.name.toLowerCase() === ingredientName.toLowerCase() && 
          p.unit.toLowerCase() === unit.toLowerCase()
        );
        
        // If no exact match with unit, try name-only match
        if (!matchedRaw) {
          matchedRaw = rawProducts.find(p => 
            p.name.toLowerCase() === ingredientName.toLowerCase()
          );
        }
        
        // If still no match, try partial name match
        if (!matchedRaw) {
          matchedRaw = rawProducts.find(p => 
            p.name.toLowerCase().includes(ingredientName.toLowerCase()) ||
            ingredientName.toLowerCase().includes(p.name.toLowerCase())
          );
        }

        if (!matchedRaw) {
          const possibleMatches = findClosestMatches(ingredientName, unit, rawProducts);
          // Check if we already have this unmatched item for the same product
          const existingUnmatched = unmatchedItems.find(
            u => u.type === 'ingredient' && 
                 u.originalName.toLowerCase() === ingredientName.toLowerCase() && 
                 u.forProductId === matchedProduct!.id
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
                productUnit: matchedProduct.unit,
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

        // Skip if recipe already exists for this product
        if (existingRecipe) {
          console.log(`[RecipeParser] Recipe already exists for ${matchedProduct.name}, skipping`);
          continue;
        }

        const existingRecipeForProduct = recipes.find(r => r.menuProductId === matchedProduct!.id);
        if (existingRecipeForProduct) {
          // Check if this ingredient already exists in the recipe
          const existingComponent = existingRecipeForProduct.components.find(
            c => c.rawProductId === matchedRaw!.id
          );
          if (!existingComponent) {
            existingRecipeForProduct.components.push({
              rawProductId: matchedRaw.id,
              quantityPerUnit: quantity
            });
          }
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
    
    // Store pending ingredients info in unmatched menu items for later resolution
    unmatchedItems.forEach(item => {
      if (item.type === 'menu') {
        const pendingKey = item.originalName.toLowerCase();
        const pendingIngredients = pendingIngredientsForUnmatchedMenu.get(pendingKey);
        if (pendingIngredients && pendingIngredients.length > 0) {
          (item as any).pendingIngredients = pendingIngredients;
        }
      }
    });

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
