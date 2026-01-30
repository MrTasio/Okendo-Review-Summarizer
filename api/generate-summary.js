/**
 * Vercel Serverless Function
 * Generates AI summaries from product reviews using Hugging Face
 * 
 * POST /api/generate-summary
 * Body: {} (no parameters needed - fetches all reviews)
 */

// Use direct fetch to Hugging Face API
// Try router endpoint first, fallback to inference endpoint
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;

/**
 * Fetch reviews from Okendo API
 * Endpoint: https://api.okendo.io/v1/stores/{storeId}/reviews
 * Handles pagination if nextUrl is present
 */
async function fetchOkendoReviews(storeId) {
  try {
    // Okendo API endpoint - fetches all reviews
    const baseUrl = `https://api.okendo.io/v1/stores/${storeId}/reviews`;
    let okendoApiUrl = baseUrl;

    // Okendo API doesn't require authentication for public reviews endpoint
    // Mimic browser request to avoid 403 errors
    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.atikawellness.com/',
      'Origin': 'https://www.atikawellness.com'
    };

    let allReviews = [];
    let hasMore = true;
    let pageCount = 0;
    const maxPages = 10; // Limit to prevent infinite loops

    // Fetch all pages of reviews
    while (hasMore && pageCount < maxPages) {
      const response = await fetch(okendoApiUrl, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Okendo API error: ${response.status} ${response.statusText}`;
        
        if (response.status === 403) {
          errorMessage += '. The API may be blocking server-side requests. This endpoint might only be accessible from browser requests.';
        }
        
        if (errorText) {
          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.message) {
              errorMessage += ` Details: ${errorJson.message}`;
            }
          } catch (e) {
            // If not JSON, include raw error text
            if (errorText.length < 200) {
              errorMessage += ` Response: ${errorText}`;
            }
          }
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      // Add reviews from this page
      if (data.reviews && Array.isArray(data.reviews)) {
        allReviews = allReviews.concat(data.reviews);
      }

      // Check if there's a next page
      if (data.nextUrl) {
        // nextUrl might be relative or absolute
        if (data.nextUrl.startsWith('http')) {
          okendoApiUrl = data.nextUrl;
        } else {
          okendoApiUrl = `https://api.okendo.io${data.nextUrl}`;
        }
        pageCount++;
      } else {
        hasMore = false;
      }
    }

    // Return in the same format as single page response
    return {
      reviews: allReviews,
      totalCount: allReviews.length
    };
  } catch (error) {
    console.error('Error fetching Okendo reviews:', error);
    throw error;
  }
}

/**
 * Extract review text from Okendo response
 * Okendo API structure: { "reviews": [{ "body": "...", ... }], "nextUrl": "..." }
 * This function handles the standard Okendo format with reviews array
 */
function extractReviewTexts(reviewsData) {
  const texts = [];
  
  // Handle Okendo standard format: { reviews: [{ body: "...", ... }] }
  if (reviewsData.reviews && Array.isArray(reviewsData.reviews)) {
    reviewsData.reviews.forEach(review => {
      // Okendo format uses "body" field for review text
      if (review.body) {
        texts.push(review.body);
      } else if (review.comment || review.text || review.reviewText) {
        // Fallback to other possible field names
        texts.push(review.comment || review.text || review.reviewText);
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
 * Generate summary using Hugging Face Router Chat Completions API
 */
async function generateSummary(reviewText, model = 'meta-llama/Meta-Llama-3.1-8B-Instruct') {
  try {
    // Truncate if too long (Hugging Face models have token limits)
    const maxLength = 8000; // Adjust based on model limits
    const truncatedText = reviewText.length > maxLength 
      ? reviewText.substring(0, maxLength) 
      : reviewText;

    // Use Hugging Face Router Chat Completions API
    const response = await fetch(
      "https://router.huggingface.co/v1/chat/completions",
      {
        headers: {
          Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `Please provide a concise summary (50-200 words) of the following customer reviews:\n\n${truncatedText}\n\nSummary:`,
            },
          ],
          model: model,
          max_tokens: 250,
          temperature: 0.7,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hugging Face API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Extract summary from chat completions response
    if (result.choices && result.choices[0] && result.choices[0].message) {
      return result.choices[0].message.content.trim();
    } else if (result.content) {
      return result.content.trim();
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
    const model = req.body?.model || 'meta-llama/Meta-Llama-3.1-8B-Instruct';

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
