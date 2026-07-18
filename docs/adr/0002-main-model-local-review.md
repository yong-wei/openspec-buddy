# Make main-model local review the lightweight default

The default lightweight workflow uses the GPT-5.6 main model for pre-commit Local Review and does not require an independent subagent for every change. When the user has authorized subagents, the main model may independently decide whether the change risk justifies a separate reviewer and which permitted model and reasoning strength to use; simple changes may proceed directly after tests and Local Review. This preserves risk-based review without making subagent dispatch and waiting part of every task.
