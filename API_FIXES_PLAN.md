# 🔥 OVERNIGHT API FIXES - EXECUTION PLAN

**Branch:** `feature/overnight-api-fixes`  
**Deadline:** 8 AM IST  
**Agent:** Chhawa (backend-goat-overnight)

---

## 🎯 ISSUES IDENTIFIED

### 1. RAW JSON ERRORS IN UI
**Problem:** Backend sends `{ error: "message" }` → Frontend displays raw JSON  
**Fix:** User-friendly error messages with actionable steps

### 2. INPUT VALIDATION MISSING
**Problem:** No validation before hitting API → waste quota on bad input  
**Fix:** Validate all inputs, return 400 with clear errors

### 3. QUOTA ERRORS NOT HANDLED GRACEFULLY
**Problem:** OpenAI quota exceeded → generic "AI service error"  
**Fix:** Detect quota vs rate limit, show actionable message

### 4. INVALID INPUT SILENT FAILURES
**Problem:** Bad input → fallback → user thinks it worked  
**Fix:** Never silently fall back, show warnings

### 5. END-TO-END TESTING GAPS
**Problem:** Individual nodes work, but chains might break  
**Fix:** Real API testing for all 5 nodes

---

## 🔧 PHASES

1. Error Messages (30 min)
2. Input Validation (45 min)
3. Error Handling (30 min)
4. E2E Testing (60 min)
5. PR Creation (15 min)

**Status:** STARTING PHASE 1
