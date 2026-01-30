/**
 * Vercel Serverless Function
 * Generates AI summaries from product reviews using Hugging Face
 * 
 * POST /api/generate-summary
 * Body: {} (no parameters needed - fetches all reviews)
 */

import { HfInference } from '@huggingface/inference';

// Initialize Hugging Face client
const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

/**
 * Fetch reviews from Okendo API
 * Endpoint: https://api.okendo.io/v1/stores/{storeId}/reviews
 */
async function fetchOkendoReviews(storeId) {
  try {
    // Okendo API endpoint - fetches all reviews
    const okendoApiUrl = `https://api.okendo.io/v1/stores/${storeId}/reviews`;

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    // Add API key if available
    if (process.env.OKENDO_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.OKENDO_API_KEY}`;
    }

    const response = await fetch(okendoApiUrl, { headers });

    if (!response.ok) {
      throw new Error(`Okendo API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching Okendo reviews:', error);
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
    // Get Okendo Store ID from environment or request
    const okendoStoreId = process.env.OKENDO_STORE_ID || '4300ec1c-fb7f-4c70-ab01-abaff548cb9a';
    const model = req.body?.model || 'facebook/bart-large-cnn';

    // Check for API key
    if (!process.env.HUGGINGFACE_API_KEY) {
      return res.status(500).json({ error: 'Hugging Face API key not configured' });
    }

    // Fetch all reviews from Okendo
    const reviewsData = await fetchOkendoReviews(okendoStoreId);

    // Extract review texts
    const reviewTexts = extractReviewTexts(reviewsData);
    
    if (reviewTexts.length === 0) {
      return res.status(404).json({ 
        error: 'No reviews found',
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
