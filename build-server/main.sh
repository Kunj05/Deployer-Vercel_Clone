#!/bin/bash
export GIT_REPOSITORY_URL="$GIT_REPOSITORY_URL"

# Cline the Repo
git clone "$GIT_REPOSITORY_URL" /home/app/output


# Call the script.js
exec node script.js