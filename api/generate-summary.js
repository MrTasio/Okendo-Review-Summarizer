/**
 * Vercel Serverless Function
 * Generates AI summaries from product reviews using Hugging Face
 * 
 * POST /api/generate-summary
 * Body: {} (no parameters needed - fetches all reviews)
 */

// Use direct fetch to Hugging Face API with new endpoint
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const HUGGINGFACE_ENDPOINT = 'https://router.huggingface.co';

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
 * Generate summary using Hugging Face API (new endpoint)
 */
async function generateSummary(reviewText, model = 'facebook/bart-large-cnn') {
  try {
    // Truncate if too long (Hugging Face models have token limits)
    const maxLength = 10000; // Adjust based on model limits
    const truncatedText = reviewText.length > maxLength 
      ? reviewText.substring(0, maxLength) 
      : reviewText;

    // Use Hugging Face API directly with new router endpoint
    // Router endpoint format: https://router.huggingface.co/models/{model}
    const response = await fetch(`${HUGGINGFACE_ENDPOINT}/models/${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: truncatedText,
        parameters: {
          max_length: 200, // Maximum length of summary
          min_length: 50,   // Minimum length of summary
          do_sample: false
        },
        options: {
          wait_for_model: true
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hugging Face API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Handle different response formats
    if (result.summary_text) {
      return result.summary_text;
    } else if (Array.isArray(result) && result[0] && result[0].summary_text) {
      return result[0].summary_text;
    } else if (result[0] && typeof result[0] === 'string') {
      return result[0];
    } else {
      throw new Error('Unexpected response format from Hugging Face API');
    }
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
