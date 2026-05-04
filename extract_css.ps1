# Read index.html
$content = [System.IO.File]::ReadAllText("index.html", [System.Text.Encoding]::UTF8)

# Extract CSS between <style> and </style>
$pattern = '(?s)<style>(.*?)</style>'
$match = [System.Text.RegularExpressions.Regex]::Match($content, $pattern)

if ($match.Success) {
    $css = $match.Groups[1].Value.Trim()
    # Write style.css as UTF-8 without BOM
    [System.IO.File]::WriteAllText("style.css", $css, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "style.css created successfully."
    
    # Remove <style> block from index.html and add link
    $newContent = [System.Text.RegularExpressions.Regex]::Replace($content, $pattern, '<link rel="stylesheet" href="style.css" />')
    [System.IO.File]::WriteAllText("index.html", $newContent, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "index.html updated to use style.css."
} else {
    Write-Error "Could not find <style> block in index.html."
}
