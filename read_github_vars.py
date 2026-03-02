#!/usr/bin/env python3
"""
Script to read and display GitHub Actions variables and secrets.
This script tests reading environment variables that are made available by GitHub Actions.
"""

import os
import sys
from datetime import datetime


def read_github_variables():
    """Read and display GitHub Actions variables."""
    
    print("=" * 60)
    print("GitHub Actions Variables Reader")
    print("=" * 60)
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # Read custom secret from GitHub Actions
    github_token = os.getenv('MYGITHUB_TOKEN')
    
    # Read action variables passed from previous step
    action_var_1 = os.getenv('ACTION_VAR_1')
    action_var_2 = os.getenv('ACTION_VAR_2')
    action_var_3 = os.getenv('ACTION_VAR_3')
    
    # Read built-in GitHub Actions environment variables
    github_event = os.getenv('GITHUB_EVENT_NAME')
    github_ref = os.getenv('GITHUB_REF')
    github_sha = os.getenv('GITHUB_SHA')
    github_actor = os.getenv('GITHUB_ACTOR')
    github_workflow = os.getenv('GITHUB_WORKFLOW')
    github_run_id = os.getenv('GITHUB_RUN_ID')
    github_run_number = os.getenv('GITHUB_RUN_NUMBER')
    github_job = os.getenv('GITHUB_JOB')
    github_server_url = os.getenv('GITHUB_SERVER_URL')
    github_repository = os.getenv('GITHUB_REPOSITORY')
    
    print("--- GitHub Actions Secrets ---")
    if github_token:
        # Show only first and last 4 characters for security
        token_display = f"{github_token[:4]}...{github_token[-4:]}" if len(github_token) > 8 else "***"
        print(f"✓ MYGITHUB_TOKEN: {token_display}")
        print(f"  Token length: {len(github_token)} characters")
        print(f"  Token is set: YES")
    else:
        print("✗ MYGITHUB_TOKEN: NOT SET")
        print("  Token is set: NO")
    
    print()
    print("--- GitHub Actions Variables (from $GITHUB_OUTPUT) ---")
    print(f"ACTION_VAR_1: {action_var_1 or 'NOT SET'}")
    print(f"ACTION_VAR_2: {action_var_2 or 'NOT SET'}")
    print(f"ACTION_VAR_3: {action_var_3 or 'NOT SET'}")
    
    print()
    print("--- GitHub Actions Environment Variables ---")
    print(f"Event Name: {github_event or 'N/A'}")
    print(f"Ref: {github_ref or 'N/A'}")
    print(f"SHA: {github_sha or 'N/A'}")
    print(f"Actor: {github_actor or 'N/A'}")
    print(f"Workflow: {github_workflow or 'N/A'}")
    print(f"Run ID: {github_run_id or 'N/A'}")
    print(f"Run Number: {github_run_number or 'N/A'}")
    print(f"Job: {github_job or 'N/A'}")
    print(f"Server URL: {github_server_url or 'N/A'}")
    print(f"Repository: {github_repository or 'N/A'}")
    
    print()
    print("--- Test Results ---")
    
    all_vars_present = True
    
    if not github_token:
        print("✗ MYGITHUB_TOKEN secret is missing!")
        all_vars_present = False
    else:
        print("✓ MYGITHUB_TOKEN secret successfully read")
    
    if not action_var_1:
        print("✗ ACTION_VAR_1 is missing!")
        all_vars_present = False
    else:
        print("✓ ACTION_VAR_1 successfully read from $GITHUB_OUTPUT")
    
    if not action_var_2:
        print("✗ ACTION_VAR_2 is missing!")
        all_vars_present = False
    else:
        print("✓ ACTION_VAR_2 successfully read from $GITHUB_OUTPUT")
    
    if not action_var_3:
        print("✗ ACTION_VAR_3 is missing!")
        all_vars_present = False
    else:
        print("✓ ACTION_VAR_3 successfully read from $GITHUB_OUTPUT")
    
    if not github_event:
        print("✗ GITHUB_EVENT_NAME is missing!")
        all_vars_present = False
    else:
        print("✓ GITHUB_EVENT_NAME is present")
    
    if not github_repository:
        print("✗ GITHUB_REPOSITORY is missing!")
        all_vars_present = False
    else:
        print("✓ GITHUB_REPOSITORY is present")
    
    print()
    print("=" * 60)
    
    if all_vars_present:
        print("SUCCESS: All required variables are available!")
        print("=" * 60)
        return 0
    else:
        print("FAILURE: Some variables are missing!")
        print("=" * 60)
        return 1


def read_output_variable(var_name: str):
    """Read a specific output variable from previous step."""
    value = os.getenv(var_name)
    if value:
        print(f"Output variable '{var_name}': {value}")
        return value
    else:
        print(f"Output variable '{var_name}': NOT SET")
        return None


if __name__ == "__main__":
    # Read all GitHub variables
    exit_code = read_github_variables()
    
    # Try to read any passed arguments as variable names
    if len(sys.argv) > 1:
        print("\n--- Reading Additional Variables ---")
        for var_name in sys.argv[1:]:
            read_output_variable(var_name)
    
    sys.exit(exit_code)
