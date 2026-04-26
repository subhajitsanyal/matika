# CareLog Pilot Feedback Form

**Date:** ___________
**User ID:** ___________
**Role:** [ ] Patient  [ ] Caregiver  [ ] Doctor
**Language Used:** [ ] English  [ ] Hindi  [ ] Bengali

---

## 1. Daily Usage

- Did you use CareLog today?  [ ] Yes  [ ] No
- If no, why not? ___________
- How many sessions did you have today? ___________
- Approximate total time spent: ___________ minutes

---

## 2. Voice Interaction Quality

Rate each on a scale of 1-5 (1 = Poor, 5 = Excellent):

| Aspect | Rating (1-5) | Comments |
|--------|-------------|----------|
| Understanding (did it hear you correctly?) | | |
| Response quality (were responses helpful?) | | |
| Natural-ness (did it feel like a natural conversation?) | | |
| Pronunciation (did the voice sound clear?) | | |

---

## 3. Value Accuracy

- Were the extracted vital values correct?  [ ] Always  [ ] Usually  [ ] Sometimes  [ ] Rarely  [ ] Never
- How often did you need to correct a value? ___________ times out of ___________ readings
- Which values were most often incorrect? ___________
- Example of an incorrect extraction (what you said vs. what it recorded):
  - Said: ___________
  - Recorded: ___________

---

## 4. Language Quality

- Did the app understand your language well?  [ ] Yes  [ ] Mostly  [ ] Sometimes  [ ] Rarely
- Any specific words or phrases it struggled with? ___________
- Did you use mixed languages (e.g., Hindi with English medical terms)?  [ ] Yes  [ ] No
- If yes, how well did it handle mixed language? (1-5): ___________

---

## 5. Speed & Performance

- Did the app feel fast enough?  [ ] Yes  [ ] Acceptable  [ ] Slow  [ ] Very slow
- Did you notice any delays?  [ ] No delays  [ ] Occasional  [ ] Frequent  [ ] Constant
- Where did you notice the most delay?
  [ ] After speaking (waiting for understanding)
  [ ] Waiting for the response
  [ ] Waiting for the voice to play
  [ ] Other: ___________

---

## 6. Overall Experience

Rate on a scale of 1-5 (1 = Very difficult, 5 = Very easy):

| Aspect | Rating (1-5) |
|--------|-------------|
| Ease of starting a session | |
| Ease of reporting vitals | |
| Ease of reviewing history | |
| Overall satisfaction | |

Would you recommend CareLog to others?  [ ] Yes  [ ] Maybe  [ ] No

---

## 7. Open Feedback

**What worked well?**

___________

**What was frustrating?**

___________

**What feature would you most like to see improved or added?**

___________

---

## 8. Bug Reports

For each bug encountered, fill in a row:

| # | Description | Steps to Reproduce | Severity (Low/Medium/High/Critical) | Screenshot? |
|---|-------------|-------------------|--------------------------------------|------------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

---

## JSON Submission Format

For automated collection, submit feedback as JSON:

```json
{
  "date": "2026-04-25",
  "user_id": "user-uuid",
  "role": "patient",
  "language": "hi",
  "daily_usage": {
    "used_today": true,
    "session_count": 2,
    "total_minutes": 15
  },
  "voice_quality": {
    "understanding": 4,
    "response_quality": 4,
    "naturalness": 3,
    "pronunciation": 4
  },
  "value_accuracy": {
    "accuracy": "usually",
    "corrections_needed": 1,
    "total_readings": 5,
    "problematic_values": ["blood_pressure"]
  },
  "language_quality": {
    "understanding": "mostly",
    "struggled_words": [],
    "used_mixed_language": true,
    "mixed_language_rating": 4
  },
  "speed": {
    "fast_enough": "yes",
    "delay_frequency": "occasional",
    "delay_location": "waiting_for_response"
  },
  "overall": {
    "ease_start_session": 5,
    "ease_report_vitals": 4,
    "ease_review_history": 3,
    "overall_satisfaction": 4,
    "would_recommend": "yes"
  },
  "open_feedback": {
    "what_worked": "Voice interaction felt natural",
    "what_frustrated": "Sometimes slow to respond",
    "feature_request": "Reminders for medication"
  },
  "bugs": [
    {
      "description": "App froze after reporting BP",
      "steps": "1. Start session 2. Say BP value 3. App froze",
      "severity": "high"
    }
  ]
}
```
