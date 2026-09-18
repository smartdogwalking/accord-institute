# Required output — version 2
Return one JSON object only, without markdown fences or commentary:
{
  "coverage": "located | not_located | uncertain",
  "summary": "Concise scenario orientation using the document's actual party names and conditional language.",
  "findings": [{
    "id": "a-unique-short-id",
    "stage": "trigger | condition | notice | cure | right | obligation | consequence | review_issue",
    "classification": "extracted | derived | review_required",
    "title": "Short finding title",
    "analysis": "Plain-English explanation including relevant conditions, exceptions and uncertainty.",
    "evidence": [{"evidence_id":"an actual supplied excerpt ID such as paragraph-2-e1"}],
    "depends_on": ["prerequisite-finding-id"]
  }],
  "open_questions": [{"question":"What must the reviewer determine?","reason":"Why the supplied document cannot settle it.","source_block_ids":["actual relevant block ID, or an empty array if no clause was located"]}]
}
The strings with alternatives above indicate permitted values: choose one, do not copy the alternatives. Maximum 24 findings, 12 open questions, 8 excerpts per finding. Keep analysis within 2,500 characters per finding. If coverage is not_located or uncertain, include at least one specific open question. If located, include at least one supported finding. Do not add a confidence score or claim professional approval. Do not create findings just to satisfy a desired number.
