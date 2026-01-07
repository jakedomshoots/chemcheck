#!/bin/bash

# Deployment Fix Script
# Clears caches and rebuilds the application to fix chunk loading issues

echo "🔧 ChemCheck Deployment Fix Script"
echo "=================================="

# Clean build artifacts
echo "📁 Cleaning build artifacts..."
rm -rf dist/
rm -rf node_modules/.vite/
rm -rf .vercel/

# Clear npm cache
echo "🧹 Clearing npm cache..."
npm cache clean --force

# Reinstall dependencies
echo "📦 Reinstalling dependencies..."
npm ci
if [ $? -ne 0 ]; then
    echo "❌ Dependency installation failed! Check the error messages above."
    exit 1
fi

# Build the application
echo "🏗️  Building application..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed! Check the error messages above."
    exit 1
fi

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo ""
    echo "📋 Next steps:"
    echo "1. Deploy to Vercel: vercel --prod"
    echo "2. Clear browser cache on the deployed site"
    echo "3. Test the business setup flow"
    echo ""
    echo "🔍 If issues persist:"
    echo "- Check browser console for specific chunk errors"
    echo "- Verify all environment variables are set in Vercel"
    echo "- Check Vercel function logs for server-side errors"
else
    echo "❌ Build failed! Check the error messages above."
    exit 1
fi