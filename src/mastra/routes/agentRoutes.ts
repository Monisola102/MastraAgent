import { registerApiRoute } from "@mastra/core/server";
import { randomUUID } from "crypto";
import { settings } from "../config/setting";

const USDA_API_KEY = settings.usdaKey;

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

interface Message {
  role: string;
  parts: Array<{
    kind: string;
    text?: string;
    data?: any;
  }>;
  messageId?: string;
  taskId?: string;
}

interface RequestBody {
  jsonrpc: string;
  id: string | null;
  params?: {
    message?: Message;
    messages?: Message[];
    contextId?: string;
    taskId?: string;
  };
}

interface FoodInfoResponse {
  foodName: string;
  calories: number;
  protein: string;
  fat: string;
  carbs: string;
  vitamins?: string[];
  minerals?: string[];
  healthBenefits: string[];
}

const foodInfoAgentRoute = registerApiRoute("/a2a/agent/food-info/:agentId", {
  method: "POST",
  handler: async (c: any) => {
    try {
      const mastra = c.get("mastra");
      const agentId = c.req.param("agentId");

      const body = (await c.req.json()) as RequestBody;
      const { jsonrpc, id: requestId, params } = body;

      if (jsonrpc !== "2.0" || !requestId) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId || null,
            error: {
              code: -32600,
              message: 'Invalid Request: jsonrpc must be "2.0" and id is required',
            },
          },
          400
        );
      }

      const agent = mastra.getAgent(agentId);
      if (!agent) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: requestId,
            error: {
              code: -32602,
              message: `Agent '${agentId}' not found`,
            },
          },
          404
        );
      }

      const { message, messages, contextId, taskId } = params || {};
      let messagesList: Message[] = [];
      if (message) messagesList = [message];
      else if (messages && Array.isArray(messages)) messagesList = messages;

      const mastraMessages = messagesList.map((msg) => ({
        role: msg.role,
        content:
          msg.parts
            ?.map((part) =>
              part.kind === "text"
                ? part.text
                : part.kind === "data"
                ? JSON.stringify(part.data)
                : ""
            )
            .join("\n") || "",
      }));

      const response = await agent.generate(mastraMessages, async () => {
        const query = messagesList[0]?.parts?.[0]?.text || "apple";
        const encodedQuery = encodeURIComponent(query);

        // 🔹 Fetch from USDA FoodData Central
        const searchUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodedQuery}&pageSize=1&api_key=${USDA_API_KEY}`;
        const searchRes = await fetch(searchUrl);
        const searchData = (await searchRes.json()) as SearchResponse;

        if (!searchData.foods?.[0])
          throw new Error(`No results found for "${query}"`);

        const food = searchData.foods[0];
        const nutrients = food.foodNutrients || [];

        const calories =
          nutrients.find((n) =>
            n.nutrientName.toLowerCase().includes("energy")
          )?.value || 0;

        const protein =
          (nutrients.find((n) =>
            n.nutrientName.toLowerCase().includes("protein")
          )?.value || 0) + " g";

        const fat =
          (nutrients.find((n) =>
            n.nutrientName.toLowerCase().includes("total lipid")
          )?.value || 0) + " g";

        const carbs =
          (nutrients.find((n) =>
            n.nutrientName.toLowerCase().includes("carbohydrate")
          )?.value || 0) + " g";

        const vitamins = nutrients
          .filter((n) => n.nutrientName.startsWith("Vitamin"))
          .map((v) => `${v.nutrientName}: ${v.value}${v.unitName}`);

        const minerals = nutrients
          .filter((n) =>
            ["Iron", "Calcium", "Potassium", "Magnesium", "Zinc", "Phosphorus"].some(
              (m) => n.nutrientName.includes(m)
            )
          )
          .map((m) => `${m.nutrientName}: ${m.value}${m.unitName}`);

        const healthBenefits: string[] = [];
        if (calories < 50)
          healthBenefits.push("Low in calories, good for weight management");
        if (vitamins.find((v) => v.includes("Vitamin C")))
          healthBenefits.push("Rich in Vitamin C, supports immune system");
        if (minerals.find((m) => m.includes("Potassium")))
          healthBenefits.push("High in Potassium, supports heart health");
        if (minerals.find((m) => m.includes("Calcium")))
          healthBenefits.push("Contains Calcium, supports bone health");
        if (healthBenefits.length === 0)
          healthBenefits.push("General source of nutrients and minerals");

        return {
          foodName: food.description,
          calories,
          protein,
          fat,
          carbs,
          vitamins: vitamins.length ? vitamins : undefined,
          minerals: minerals.length ? minerals : undefined,
          healthBenefits,
        } as FoodInfoResponse;
      });

      const fullNutritionText = `
${(response.text as FoodInfoResponse).foodName}:
Calories: ${(response.text as FoodInfoResponse).calories}
Protein: ${(response.text as FoodInfoResponse).protein}
Fat: ${(response.text as FoodInfoResponse).fat}
Carbs: ${(response.text as FoodInfoResponse).carbs}
Vitamins: ${(response.text as FoodInfoResponse).vitamins?.join(", ") || "N/A"}
Minerals: ${(response.text as FoodInfoResponse).minerals?.join(", ") || "N/A"}
Health Benefits: ${(response.text as FoodInfoResponse).healthBenefits.join(", ")}
`;

      const artifacts = [
        {
          artifactId: randomUUID(),
          name: "NutritionInfoText",
          parts: [{ kind: "text", text: fullNutritionText }],
        },
        {
          artifactId: randomUUID(),
          name: "ToolResults",
          parts: [
            {
              kind: "data",
              data: response.text,
            },
          ],
        },
      ];

      const history = [
        ...messagesList.map((msg) => ({
          kind: "message",
          role: msg.role,
          parts: msg.parts,
          messageId: msg.messageId || randomUUID(),
          taskId: msg.taskId || taskId || randomUUID(),
        })),
        {
          kind: "message",
          role: "agent",
          parts: [{ kind: "text", text: fullNutritionText }],
          messageId: randomUUID(),
          taskId: taskId || randomUUID(),
        },
      ];

      return c.json({
        jsonrpc: "2.0",
        id: requestId,
        result: {
          id: taskId || randomUUID(),
          contextId: contextId || randomUUID(),
          status: {
            state: "completed",
            timestamp: new Date().toISOString(),
            message: {
              messageId: randomUUID(),
              role: "agent",
              parts: [{ kind: "text", text: fullNutritionText }],
              kind: "message",
            },
          },
          artifacts,
          history,
          kind: "task",
        },
      });
    } catch (error: any) {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32603,
            message: "Internal error",
            data: { details: error.message },
          },
        },
        500
      );
    }
  },
});

export { foodInfoAgentRoute };
