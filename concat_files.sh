#!/bin/bash

# Get current timestamp
timestamp=$(date +"%Y%m%d_%H%M%S")
output_file="./projects/project-${timestamp}.txt"
script_name=$(basename "$0")

# Create projects directory if it doesn't exist
mkdir -p ./projects

# Function to check if a file matches gitignore patterns
is_ignored() {
    local file="$1"
    local pattern
    
    # Remove leading ./ from the file path for matching
    file="${file#./}"
    
    while IFS= read -r pattern || [ -n "$pattern" ]; do
        # Skip empty lines and comments
        [[ -z "$pattern" || "$pattern" =~ ^[[:space:]]*# ]] && continue
        
        # Trim whitespace
        pattern="$(echo "$pattern" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        [ -z "$pattern" ] && continue
        
        # Convert pattern to regex
        # Handle specific patterns we know exist in the gitignore
        case "$pattern" in
            "node_modules/"*)
                if [[ "$file" == node_modules/* ]]; then
                    return 0
                fi
                ;;
            "node_modules")
                if [[ "$file" == node_modules/* || "$file" == "node_modules" ]]; then
                    return 0
                fi
                ;;
            *.*)
                # Handle file extensions and wildcard patterns
                pattern="$(echo "$pattern" | sed 's/\./\\./g' | sed 's/\*/.*/')"
                if [[ "$file" =~ ^${pattern}$ || "$file" =~ ^.*/${pattern}$ ]]; then
                    return 0
                fi
                ;;
            *)
                # Handle directory patterns
                if [[ "$pattern" == */ ]]; then
                    if [[ "$file" == "$pattern"* || "$file" == */"$pattern"* ]]; then
                        return 0
                    fi
                else
                    if [[ "$file" == "$pattern" || "$file" == */"$pattern" ]]; then
                        return 0
                    fi
                fi
                ;;
        esac
    done < ".gitignore"
    
    return 1
}

# Initialize output file
echo "Starting concatenation at $(date)" > "$output_file"

# Find all files and process them
find . -type f -not -path "./logs/*" -not -path "./node_modules/*" -not -path "./projects/*" -not -path "./.git/*" -not -name "$script_name" | sort | while IFS= read -r file; do
    # Skip if file matches gitignore patterns
    if [ -f ".gitignore" ] && is_ignored "$file"; then
        echo "Skipping ignored file: $file"
        continue
    fi
    
    # Check if file is readable before attempting to process
    if [ -r "$file" ]; then
        echo "Processing: ${file#./}"
        {
            echo -e "\n=== File: ${file#./} ==="
            cat "$file"
        } >> "$output_file"
    else
        echo "Warning: Cannot read file $file"
    fi
done

echo "Concatenation complete. Output written to: $output_file"

# Verify the output file was created and has content
if [ -s "$output_file" ]; then
    echo "Success! Output file created with $(wc -l < "$output_file") lines"
else
    echo "Warning: Output file is empty"
fi