# Review Summary Generator API

This is a Vercel serverless function that generates AI summaries from product reviews using Hugging Face.

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Get Hugging Face API Key

1. Go to [Hugging Face](https://huggingface.co/)
2. Sign up or log in
3. Go to Settings → Access Tokens
4. Create a new token with "Read" permissions
5. Copy the token

### 3. Get Okendo Store ID

1. Log into your Okendo dashboard
2. Find your Store ID in the URL or settings
   - Example: `4300ec1c-fb7f-4c70-ab01-abaff548cb9a`
3. You can also find it in your Shopify theme's Okendo configuration

### 4. Deploy to Vercel

#### Option A: Using Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
vercel
```

#### Option B: Using GitHub

1. Push this folder to a GitHub repository
2. Go to [Vercel](https://vercel.com)
3. Click "New Project"
4. Import your GitHub repository
5. Vercel will auto-detect the project

### 5. Set Environment Variables

In your Vercel project dashboard:

1. Go to Settings → Environment Variables
2. Add the following:

```
HUGGINGFACE_API_KEY=your_huggingface_token_here
OKENDO_STORE_ID=your_okendo_store_id_here (optional, can be set per request)
```

### 6. Get Your API URL

After deployment, Vercel will give you a URL like:
```
https://your-project-name.vercel.app/api/generate-summary
```

Copy this URL and use it in your Shopify theme section settings.

## API Usage

### Endpoint
```
POST /api/generate-summary
```

### Request Body
```json
{
  "productId": "7257133121633",
  "okendoStoreId": "4300ec1c-fb7f-4c70-ab01-abaff548cb9a",
  "model": "facebook/bart-large-cnn"
}
```

### Response
```json
{
  "success": true,
  "summary": "Generated summary text here...",
  "reviewCount": 25,
  "model": "facebook/bart-large-cnn"
}
```

## Available Hugging Face Models

You can use different summarization models:

- `facebook/bart-large-cnn` (default) - Best for general summarization
- `google/pegasus-xsum` - Good for abstractive summaries
- `sshleifer/distilbart-cnn-12-6` - Faster, smaller model
- `facebook/bart-large-xsum` - Good for very long texts

## Troubleshooting

### Error: "No reviews found"
- Check that your Product ID is correct
- Verify your Okendo Store ID is correct
- Ensure the product has reviews in Okendo

### Error: "Hugging Face API key not configured"
- Make sure you've set the `HUGGINGFACE_API_KEY` environment variable in Vercel
- Redeploy after adding environment variables

### Error: "Okendo API error"
- Check that your Okendo Store ID is correct
- Verify you have API access to Okendo (may require API key)
- The endpoint used is: `https://api.okendo.io/v1/stores/{storeId}/reviews`
- If filtering by product ID doesn't work, the API will fetch all reviews and filter client-side

### CORS Errors
- The API is configured to allow all origins
- If you still get CORS errors, check your Vercel configuration

## Local Development

```bash
# Install Vercel CLI
npm i -g vercel

# Run locally
vercel dev
```

The API will be available at `http://localhost:3000/api/generate-summary`

## Notes

- The free tier of Hugging Face has rate limits
- Okendo API may require authentication - adjust `fetchOkendoReviews` if needed
- Review text is truncated to 10,000 characters to fit model limits
- Summary length is set to 50-200 characters (adjustable in code)

