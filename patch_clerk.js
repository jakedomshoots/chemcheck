import fs from 'fs';
const path = 'node_modules/@clerk/clerk-js/dist/clerk.mjs';

try {
    let content = fs.readFileSync(path, 'utf8');
    console.log(`Read ${content.length} bytes from ${path}`);

    // 1. Log on Throw
    const throwPattern = /throw Error\(`\${([^}]+?)} Something went wrong initializing Clerk\.`\)/;
    const matchThrow = content.match(throwPattern);

    if (matchThrow) {
        console.log('Found throw pattern:', matchThrow[0]);
        const errVar = matchThrow[1];
        const replacement = `
            console.error("***** CLERK INIT FAIL *****");
            try {
                console.error("Error Message:", ${errVar}.message);
                console.error("Error Status:", ${errVar}.status);
                console.error("Error JSON:", JSON.stringify(${errVar}));
                console.error("Error Raw:", ${errVar});
            } catch (err) {
                 console.error("Failed to log error details:", err);
            }
            console.error("Stack:", new Error().stack);
            ${matchThrow[0]}`;
        content = content.replace(matchThrow[0], replacement);
        console.log('Replaced throw pattern.');
    } else {
        console.error('Could not find throw pattern!');
    }

    // 2. Log in Catch (Generic)
    const catchRegex = /if\(\([0-9a-zA-Z,._]+\)\(([a-zA-Z0-9_]+),"dev_browser_unauthenticated"\)\)/;
    const matchCatch = content.match(catchRegex);

    if (matchCatch) {
        console.log('Found catch pattern:', matchCatch[0]);
        const errVar = matchCatch[1];

        const replacement = matchCatch[0].replace('if(', `if((console.error("CLERK_SWALLOWED_ERROR", ${errVar}), `) + ')';

        content = content.replace(matchCatch[0], replacement);
        console.log('Replaced catch pattern.');
    } else {
        console.error('Could not match catch pattern regex.');
    }

    fs.writeFileSync(path, content);
    console.log('File patched successfully.');

} catch (e) {
    console.error('Patch failed:', e);
    process.exit(1);
}
