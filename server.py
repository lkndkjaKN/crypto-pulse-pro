#!/usr/bin/env python3
"""
CryptoPulse Pro Backend Server v2.0
Complete integration with all APIs
"""

import asyncio
from datetime import datetime
from typing import Dict, Optional
import os
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from cachetools import TTLCache
import praw
from openai import AsyncOpenAI
from binance import AsyncClient as BinanceClient

# Load environment variables
load_dotenv()

# Configuration
class Config:
    CACHE_TTL = 300  # 5 minutes cache
    REQUEST_TIMEOUT = 30
    MAX_RETRIES = 3

# Initialize FastAPI app
app = FastAPI(
    title="CryptoPulse Pro API",
    description="Advanced cryptocurrency analysis engine",
    version="2.0.0"
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=600
)

# Cache setup
analysis_cache = TTLCache(maxsize=1000, ttl=Config.CACHE_TTL)

# API Clients
class APIClients:
    def __init__(self):
        self.coingecko = httpx.AsyncClient(
            base_url="https://api.coingecko.com/api/v3",
            timeout=Config.REQUEST_TIMEOUT,
            headers={"x-cg-pro-api-key": os.getenv("COINGECKO_API_KEY")},
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)
        )
        self.binance = BinanceClient(
            os.getenv("BINANCE_API_KEY"),
            os.getenv("BINANCE_SECRET_KEY")
        )
        self.openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.reddit = praw.Reddit(
            client_id=os.getenv("REDDIT_CLIENT_ID"),
            client_secret=os.getenv("REDDIT_CLIENT_SECRET"),
            user_agent=os.getenv("REDDIT_USER_AGENT")
        )

    async def close_all(self):
        await self.coingecko.aclose()
        await self.binance.close_connection()

# Models
class AnalysisResponse(BaseModel):
    coin: str
    analysis: str
    timestamp: datetime
    raw_data: Optional[Dict]

# Helper Functions
async def fetch_with_retry(client, endpoint: str, params: Dict = None, retries: int = Config.MAX_RETRIES):
    for attempt in range(retries):
        try:
            if isinstance(client, httpx.AsyncClient):
                response = await client.get(endpoint, params=params)
                response.raise_for_status()
                return response.json()
        except Exception as e:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(1)

# Data Fetching Functions
async def get_coingecko_data(clients, coin: str) -> Dict:
    data = await fetch_with_retry(
        clients.coingecko,
        f"/coins/{coin.lower()}",
        params={"localization": "false", "market_data": "true"}
    )
    return {
        "symbol": data["symbol"].upper(),
        "current": data["market_data"]["current_price"]["usd"],
        "change_24h": data["market_data"]["price_change_percentage_24h"]
    }

async def get_binance_data(clients, coin: str) -> Dict:
    ticker = await clients.binance.get_ticker(symbol=f"{coin.upper()}USDT")
    return {
        "volume": float(ticker["volume"]),
        "price_change": float(ticker["priceChangePercent"])
    }

async def get_reddit_sentiment(clients, coin: str) -> Dict:
    subreddit = clients.reddit.subreddit("cryptocurrency")
    posts = []
    async for submission in subreddit.search(coin, limit=5):
        posts.append({
            "title": submission.title,
            "score": submission.score
        })
    return {
        "posts": posts[:3],
        "activity": "High" if len(posts) >= 3 else "Low"
    }

async def generate_ai_analysis(clients, market_data: Dict) -> str:
    prompt = f"""
    Generate professional crypto analysis report with:
    1. Market summary
    2. Trading strategy
    3. Price prediction
    Based on: {market_data}
    """
    
    response = await clients.openai.chat.completions.create(
        model="gpt-4",
        messages=[{"role": "system", "content": "You are a professional crypto analyst"}, 
                 {"role": "user", "content": prompt}],
        temperature=0.7
    )
    return response.choices[0].message.content

# Main Analysis Endpoint
@app.get("/analyze/{coin}", response_model=AnalysisResponse)
async def analyze_coin(coin: str):
    if not coin.isalpha():
        raise HTTPException(status_code=400, detail="Invalid coin symbol")
    
    cache_key = coin.lower()
    if cache_key in analysis_cache:
        return analysis_cache[cache_key]
    
    try:
        clients = APIClients()
        price_data, binance_data, reddit_data = await asyncio.gather(
            get_coingecko_data(clients, coin),
            get_binance_data(clients, coin),
            get_reddit_sentiment(clients, coin)
        )
        
        market_data = {
            "price": price_data,
            "market": binance_data,
            "social": reddit_data
        }
        
        analysis = await generate_ai_analysis(clients, market_data)
        
        response = {
            "coin": coin.upper(),
            "analysis": analysis,
            "timestamp": datetime.utcnow(),
            "raw_data": market_data
        }
        
        analysis_cache[cache_key] = response
        return response
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(e)}"
        )
    finally:
        await clients.close_all()

# Health Check
@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)