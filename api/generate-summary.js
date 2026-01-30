/**
 * Vercel Serverless Function
 * Generates AI summaries from product reviews using Hugging Face
 * 
 * POST /api/generate-summary
 * Body: {
 *   productId: string (Shopify Product ID),
 *   okendoStoreId: string (optional),
 *   model: string (optional, default: facebook/bart-large-cnn)
 * }
 */

import { HfInference } from '@huggingface/inference';

// Initialize Hugging Face client
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

/**
 * Fetch reviews from Okendo API
 * Endpoint: https://api.okendo.io/v1/stores/{storeId}/reviews
 */
async function fetchOkendoReviews(productId, storeId) {
  try {
    // Correct Okendo API endpoint
    const okendoApiUrl = `https://api.okendo.io/v1/stores/${storeId}/reviews`;
    
    // Build query parameters - filter by product ID if provided
    const params = new URLSearchParams();
    if (productId) {
      // Okendo may use different product ID formats
      // Try both Shopify product ID and shopify-{id} format
      params.append('productId', `shopify-${productId}`);
      // Also try without prefix in case Okendo accepts it directly
    }
    
    const url = params.toString() 
      ? `${okendoApiUrl}?${params.toString()}`
      : okendoApiUrl;

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // Add API key if available
    if (process.env.OKENDO_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.OKENDO_API_KEY}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      // If filtering by productId fails, try fetching all reviews and filter client-side
      if (productId && response.status === 404) {
        console.log('Product-specific endpoint not found, fetching all reviews...');
        const allReviewsResponse = await fetch(okendoApiUrl, { headers });
        if (allReviewsResponse.ok) {
          const allReviews = await allReviewsResponse.json();
          // Filter reviews by product ID client-side
          return filterReviewsByProduct(allReviews, productId);
        }
      }
      throw new Error(`Okendo API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // If we got all reviews, filter by product ID if needed
    if (productId && data.reviews) {
      return filterReviewsByProduct(data, productId);
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching Okendo reviews:', error);
    throw error;
  }
}

/**
 * Filter reviews by Shopify product ID
 * Handles different product ID formats that Okendo might use
 */
function filterReviewsByProduct(reviewsData, productId) {
  if (!reviewsData || !reviewsData.reviews) {
    return reviewsData;
  }

  const filteredReviews = reviewsData.reviews.filter(review => {
    // Check various possible product ID fields
    const reviewProductId = review.productId || 
                            review.product_id || 
                            review.shopifyProductId ||
                            review.shopify_product_id;
    
    // Match different formats: "shopify-7257133121633", "7257133121633", etc.
    return reviewProductId && (
      reviewProductId === productId ||
      reviewProductId === `shopify-${productId}` ||
      reviewProductId.toString().endsWith(productId.toString())
    );
  });

  return {
    ...reviewsData,
    reviews: filteredReviews
  };
}

/**
 * Alternative: Fetch reviews from Shopify Product Reviews API
 * If you're using Shopify's native reviews or another review app
 */
async function fetchShopifyReviews(productId) {
  try {
    // This would require Shopify Admin API access
    // For now, we'll use Okendo as primary method
    // You can extend this to support other review platforms
    return null;
  } catch (error) {
    console.error('Error fetching Shopify reviews:', error);
    throw error;
  }
}

/**
 * Extract review text from Okendo response
 * Okendo API structure may vary - this handles multiple possible formats
 */
function extractReviewTexts(reviewsData) {
  const texts = [];
  
  // Handle different possible Okendo API response structures
  if (reviewsData.reviews && Array.isArray(reviewsData.reviews)) {
    reviewsData.reviews.forEach(review => {
      if (review.body || review.comment || review.text || review.reviewText) {
        texts.push(review.body || review.comment || review.text || review.reviewText);
      }
    });
  } else if (reviewsData.data && Array.isArray(reviewsData.data)) {
    reviewsData.data.forEach(review => {
      if (review.body || review.comment || review.text || review.reviewText) {
        texts.push(review.body || review.comment || review.text || review.reviewText);
      }
    });
  } else if (reviewsData.items && Array.isArray(reviewsData.items)) {
    reviewsData.items.forEach(review => {
      if (review.body || review.comment || review.text || review.reviewText) {
        texts.push(review.body || review.comment || review.text || review.reviewText);
      }
    });
  } else if (Array.isArray(reviewsData)) {
    // If the response is directly an array
    reviewsData.forEach(review => {
      if (review.body || review.comment || review.text || review.reviewText) {
        texts.push(review.body || review.comment || review.text || review.reviewText);
      }
    });
  }
  
  // Log structure for debugging (remove in production if needed)
  if (texts.length === 0 && process.env.NODE_ENV === 'development') {
    console.log('Okendo API response structure:', JSON.stringify(reviewsData, null, 2));
  }
  
  return texts;
}

/**
 * Combine all reviews into a single text for summarization
 */
function combineReviews(reviewTexts) {
  return reviewTexts
    .filter(text => text && text.trim().length > 0)
    .join('\n\n');
}

/**
 * Generate summary using Hugging Face
 */
async function generateSummary(reviewText, model = 'facebook/bart-large-cnn') {
  try {
    // Truncate if too long (Hugging Face models have token limits)
    const maxLength = 10000; // Adjust based on model limits
    const truncatedText = reviewText.length > maxLength 
      ? reviewText.substring(0, maxLength) 
      : reviewText;

    // Use Hugging Face summarization
    const result = await hf.summarization({
      model: model,
      inputs: truncatedText,
      parameters: {
        max_length: 200, // Maximum length of summary
        min_length: 50,   // Minimum length of summary
        do_sample: false
      }
    });

    return result.summary_text;
  } catch (error) {
    console.error('Error generating summary:', error);
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { productId, okendoStoreId, model = 'facebook/bart-large-cnn' } = req.body;

    // Validate input
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    // Check for API key
    if (!process.env.HUGGINGFACE_API_KEY) {
      return res.status(500).json({ error: 'Hugging Face API key not configured' });
    }

    // Fetch reviews
    let reviewsData;
    if (okendoStoreId) {
      reviewsData = await fetchOkendoReviews(productId, okendoStoreId);
    } else {
      // Try to use default store ID from env or fallback
      const defaultStoreId = process.env.OKENDO_STORE_ID;
      if (defaultStoreId) {
        reviewsData = await fetchOkendoReviews(productId, defaultStoreId);
      } else {
        return res.status(400).json({ 
          error: 'Okendo Store ID is required. Set it in request body or environment variable.' 
        });
      }
    }

    // Extract review texts
    const reviewTexts = extractReviewTexts(reviewsData);
    
    if (reviewTexts.length === 0) {
      return res.status(404).json({ 
        error: 'No reviews found for this product',
        reviewCount: 0
      });
    }

    // Combine reviews
    const combinedText = combineReviews(reviewTexts);

    // Generate summary
    const summary = await generateSummary(combinedText, model);

    // Return result
    return res.status(200).json({
      success: true,
      summary: summary,
      reviewCount: reviewTexts.length,
      model: model
    });

  } catch (error) {
    console.error('Error in generate-summary:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

