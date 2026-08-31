from tools.llm.context import ContextBudgetPolicy


def test_policy_reserves_output_and_provider_safety_margin():
    policy = ContextBudgetPolicy(64000, 24000)

    assert policy.reserved_output_tokens == 24000
    assert policy.safety_tokens == 1920
    assert policy.input_budget_tokens == 38080


def test_bad_output_configuration_cannot_consume_the_whole_window():
    policy = ContextBudgetPolicy(12000, 50000)

    assert policy.reserved_output_tokens == 10464
    assert policy.input_budget_tokens == 1024


def test_staircase_boundaries_and_proportional_targets_are_stable():
    policy = ContextBudgetPolicy(1000, 0, input_budget_override=1000)

    expected = [
        (700, 0, 1000),
        (701, 1, 700),
        (850, 1, 700),
        (851, 2, 800),
        (1000, 2, 800),
        (1001, 3, 880),
        (1200, 3, 880),
        (1201, 4, 900),
    ]
    assert [
        (used, policy.plan(used).level, policy.plan(used).target_tokens)
        for used, _, _ in expected
    ] == expected


def test_higher_pressure_reduces_memory_and_recent_context_shares():
    policy = ContextBudgetPolicy(1000, 0, input_budget_override=1000)

    light = policy.plan(750)
    critical = policy.plan(1300)

    assert critical.memory_ratio < light.memory_ratio
    assert critical.recent_ratio < light.recent_ratio
