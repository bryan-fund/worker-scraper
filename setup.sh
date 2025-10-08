#!/bin/bash

# Salt Lake County Scraper - Setup Script
# This script automates the initial setup process

set -e

echo "🏠 Salt Lake County Property Owner Scraper Setup"
echo "================================================"

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed"
    exit 1
fi

echo "✅ Node.js and npm found"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Install wrangler globally if not present
if ! command -v wrangler &> /dev/null; then
    echo "📦 Installing wrangler CLI..."
    npm install -g wrangler
fi

echo "✅ Dependencies installed"

# Check Cloudflare login
echo ""
echo "🔐 Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    echo "🔐 Please login to Cloudflare..."
    wrangler login
fi

echo "✅ Cloudflare authentication verified"

# Create D1 database
echo ""
echo "🗄️ Creating D1 database..."
echo "📝 You'll need to update wrangler.toml with the database ID after creation"

wrangler d1 create salt-lake-owners

echo ""
echo "📝 Please update wrangler.toml with your database ID, then run:"
echo "   npm run setup-db"
echo ""
echo "🚀 After that, you can deploy workers with:"
echo "   npm run deploy-workers"
echo ""
echo "✅ Setup complete! See README.md for next steps."