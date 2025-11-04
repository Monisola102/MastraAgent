import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { settings } from '../config/setting';

const USDA_API_KEY = settings.usdaKey;
if (!USDA_API_KEY) {
  throw new Error("USDA_API_KEY is missing from your environment variables.");
}

interface Nutrient {
  nutrientName: string;
  value: number;
  unitName: string;
}

interface FoodItem {
  description: string;
  fdcId: number;
  foodNutrients: Nutrient[];
}

interface SearchResponse {
  foods: FoodItem[];
}

interface FoodInfoResult {
  foodName: string;
  calories: number;
  protein: string;
  fat: string;
  carbs: string;
  vitamins?: string[];
  minerals?: string[];
  healthBenefits: string[];
}

export const foodInfoTool = createTool({
  id: 'get-food-info',
  description: 'Fetch nutritional information, vitamins, minerals, and health benefits for any food using the USDA FoodData Central API',
  inputSchema: z.object({
    food: z.string().describe('Name of the food to look up'),
  }),
  outputSchema: z.object({
    foodName: z.string(),
    calories: z.number().optional(),
    protein: z.string().optional(),
    fat: z.string().optional(),
    carbs: z.string().optional(),
    vitamins: z.array(z.string()).optional(),
    minerals: z.array(z.string()).optional(),
    healthBenefits: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    return await getFoodInfo(context.food);
  },
});

const getFoodInfo = async (foodName: string): Promise<FoodInfoResult> => {
  const query = encodeURIComponent(foodName.trim().toLowerCase());
  const searchUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${query}&pageSize=1&api_key=${USDA_API_KEY}`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) throw new Error(`USDA API search failed for "${foodName}"`);
  const searchData = (await searchRes.json()) as SearchResponse;

  if (!searchData.foods || searchData.foods.length === 0)
    throw new Error(`No USDA data found for "${foodName}"`);

  const food = searchData.foods[0];
  const nutrients = food.foodNutrients || [];

  const calories =
    nutrients.find((n) => n.nutrientName.toLowerCase().includes('energy'))?.value || 0;
  const protein =
    (nutrients.find((n) => n.nutrientName.toLowerCase().includes('protein'))?.value || 0) +
    ' g';
  const fat =
    (nutrients.find((n) => n.nutrientName.toLowerCase().includes('total lipid'))?.value || 0) +
    ' g';
  const carbs =
    (nutrients.find((n) => n.nutrientName.toLowerCase().includes('carbohydrate'))?.value || 0) +
    ' g';

  const vitamins = nutrients
    .filter((n) => n.nutrientName.startsWith('Vitamin'))
    .map((v) => `${v.nutrientName}: ${v.value}${v.unitName}`);

  const minerals = nutrients
    .filter((n) =>
      ['Iron', 'Calcium', 'Potassium', 'Magnesium', 'Zinc', 'Phosphorus'].some((m) =>
        n.nutrientName.includes(m)
      )
    )
    .map((m) => `${m.nutrientName}: ${m.value}${m.unitName}`);

  const healthBenefits: string[] = [];
  if (calories < 50) healthBenefits.push('Low in calories, good for weight management');
  if (vitamins.find((v) => v.includes('Vitamin C')))
    healthBenefits.push('Rich in Vitamin C, supports immune system');
  if (minerals.find((m) => m.includes('Potassium')))
    healthBenefits.push('High in Potassium, supports heart health');
  if (minerals.find((m) => m.includes('Calcium')))
    healthBenefits.push('Contains Calcium, supports bone health');
  if (healthBenefits.length === 0) healthBenefits.push('Provides essential nutrients and energy');

  return {
    foodName: food.description,
    calories,
    protein,
    fat,
    carbs,
    vitamins: vitamins.length ? vitamins : undefined,
    minerals: minerals.length ? minerals : undefined,
    healthBenefits,
  };
};
