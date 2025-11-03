import dotenv from "dotenv";

dotenv.config();


const usdaKey = process.env.USDA_API_KEY;

export const settings ={usdaKey};