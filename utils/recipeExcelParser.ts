import * as XLSX from 'xlsx';
import { Recipe, RecipeComponent, Product, ProductConversion } from '@/types';

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

export function parseRecipeExcelFile(
  base64Data: string, 
  existingProducts: Product[], 
  productConversions: ProductConversion[] = []
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

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const range = XLSX.utils.decode_range(firstSheet['!ref'] || 'A1');
    
    const productNameCol = 'P';
    const productUnitCol = 'F';
    const rawMaterialNameCol = 'I';
    const rawMaterialUnitCol = 'O';
    const rawMaterialQtyCol = 'R';

    const menuProducts = existingProducts.filter(p => p.type === 'menu');
    const rawProducts = existingProducts.filter(p => p.type === 'raw');
    
    const conversionsByFromId = new Map<string, { toProductId: string; factor: number }>();
    productConversions.forEach(conv => {
      conversionsByFromId.set(conv.fromProductId, { toProductId: conv.toProductId, factor: conv.conversionFactor });
    });

    let currentRow = 0;
    while (currentRow <= range.e.r) {
      const productNameCell = firstSheet[`${productNameCol}${currentRow + 1}`];
      
      if (productNameCell && productNameCell.v) {
        const productName = String(productNameCell.v).trim();
        
        const productUnitCell = firstSheet[`${productUnitCol}${currentRow + 3}`];
        const productUnit = productUnitCell && productUnitCell.v ? normalizeUnit(String(productUnitCell.v)) : '';

        const matchedProduct = menuProducts.find(p => 
          p.name.toLowerCase() === productName.toLowerCase() && 
          p.unit.toLowerCase() === productUnit.toLowerCase()
        );
        
        if (!matchedProduct) {
          warnings.push(`Product "${productName}" (${productUnit}) not found in system - skipping`);
          currentRow++;
          continue;
        }

        const components: RecipeComponent[] = [];
        let rawMaterialRow = currentRow + 5;
        
        while (rawMaterialRow <= range.e.r) {
          const rawNameCell = firstSheet[`${rawMaterialNameCol}${rawMaterialRow + 1}`];
          
          if (!rawNameCell || !rawNameCell.v || String(rawNameCell.v).trim() === '') {
            break;
          }

          const rawMaterialName = String(rawNameCell.v).trim();
          const rawMaterialUnitCell = firstSheet[`${rawMaterialUnitCol}${rawMaterialRow + 1}`];
          const rawMaterialUnit = rawMaterialUnitCell && rawMaterialUnitCell.v 
            ? normalizeUnit(String(rawMaterialUnitCell.v)) 
            : '';

          const rawMaterialQtyCell = firstSheet[`${rawMaterialQtyCol}${rawMaterialRow + 1}`];
          const rawMaterialQty = rawMaterialQtyCell && rawMaterialQtyCell.v 
            ? parseFloat(String(rawMaterialQtyCell.v)) 
            : 0;

          const matchedRaw = rawProducts.find(p => 
            p.name.toLowerCase() === rawMaterialName.toLowerCase() && 
            p.unit.toLowerCase() === rawMaterialUnit.toLowerCase()
          );

          if (matchedRaw && rawMaterialQty > 0) {
            components.push({
              rawProductId: matchedRaw.id,
              quantityPerUnit: rawMaterialQty
            });
          } else if (!matchedRaw) {
            warnings.push(`Raw material "${rawMaterialName}" (${rawMaterialUnit}) not found - ignoring`);
          }

          rawMaterialRow++;
        }

        if (components.length > 0) {
          const recipe: Recipe = {
            id: `rcp-${matchedProduct.id}`,
            menuProductId: matchedProduct.id,
            components,
            updatedAt: Date.now()
          };
          recipes.push(recipe);
          console.log(`Created recipe for ${matchedProduct.name} (${matchedProduct.unit}) with ${components.length} ingredients`);

          const conversion = conversionsByFromId.get(matchedProduct.id);
          if (conversion) {
            const convertedProduct = existingProducts.find(p => p.id === conversion.toProductId);
            if (convertedProduct) {
              const convertedComponents = components.map(comp => ({
                rawProductId: comp.rawProductId,
                quantityPerUnit: comp.quantityPerUnit / conversion.factor
              }));
              
              const convertedRecipe: Recipe = {
                id: `rcp-${convertedProduct.id}`,
                menuProductId: convertedProduct.id,
                components: convertedComponents,
                updatedAt: Date.now()
              };
              recipes.push(convertedRecipe);
              console.log(`Auto-created converted recipe for ${convertedProduct.name} (${convertedProduct.unit}) by dividing by ${conversion.factor}`);
            }
          }
        } else {
          warnings.push(`No valid ingredients found for "${productName}" - skipping`);
        }

        currentRow = rawMaterialRow;
      } else {
        currentRow++;
      }
    }

    if (recipes.length === 0 && errors.length === 0) {
      errors.push('No valid recipes found in the Excel file');
    }

  } catch (error) {
    errors.push(`Failed to parse Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return { recipes, errors, warnings };
}
