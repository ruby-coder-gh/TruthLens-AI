def test_comparison_model_creation():
    from app.models.comparison import Comparison, ComparisonResult
    from uuid import uuid4
    from datetime import datetime

    # Test basic instantiation
    comp = Comparison(
        id=str(uuid4()),
        workspace_id=str(uuid4()),
        user_id=str(uuid4()),
        question="What is the main claim?",
        document_ids=["doc1", "doc2"],
        synthesis_text="Agreement on claim.",
        agreement_score=0.8,
        trust_score=0.9
    )
    assert comp.question == "What is the main claim?"
    assert comp.document_ids == ["doc1", "doc2"]

    # Test ComparisonResult
    result = ComparisonResult(
        id=str(uuid4()),
        comparison_id=comp.id,
        document_id="doc1",
        answer_text="The claim is true.",
        trust_score=0.95,
        stance="supports"
    )
    assert result.stance == "supports"