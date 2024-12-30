# AROK Mini

AROK Mini is a lightweight, plugin-based agent framework designed for building interactive AI applications. It provides a flexible architecture for handling messages across different platforms (like Twitter and API endpoints) while maintaining extensibility through a robust plugin system.

## Features

### Core Framework

- **Message Bus Architecture**: Centralized message handling system
- **Memory Service**: Persistent storage of conversations and context
- **Plugin System**: Extensible architecture for adding new capabilities
- **Multi-Platform Support**: Built-in support for different communication channels

### Built-in Clients

- **API Client**: RESTful API interface for direct communication
- **Twitter Client**: Twitter integration for social media interaction

### Plugin Support

Example Plugins to aid further development

- API Client
- Twitter Client
- RAG Query Client

**Extensible Plugin System**: Easy-to-implement plugin interface for adding new features

## Adding New Plugins

AROK Mini uses a distributed plugin system where each plugin is its own npm package. To add a new plugin, follow these steps:

1. **Install Plugin Package**

   ```bash
   npm install arok-plugin--your-plugin-name
   ```

2. **Implement Plugin Interface**
   Create an `index.ts` file in your plugin directory:

   ```typescript
   import type { Plugin, PluginContext, PluginMetadata } from "../types";

   export class YourPlugin implements Plugin {
     metadata: PluginMetadata = {
       name: "your-plugin",
       description: "Description of your plugin",
       version: "1.0.0",
       actions: {
         // Define your plugin's actions here
       }
     };

     async initialize(context: PluginContext): Promise<void> {
       // Initialize your plugin
     }

     actions = {
       // Implement your plugin's actions
     };
   }
   ```

3. **Create Plugin Repository**

   - Create a new repository named `arok-plugin--your-plugin-name`
   - Initialize with the following structure:
     ```
     arok-plugin--your-plugin-name/
     ├── src/
     │   ├── index.ts       # Main plugin code
     │   └── types.ts       # Plugin-specific types
     ├── tests/
     │   └── index.test.ts  # Plugin tests
     ├── package.json
     ├── tsconfig.json
     └── README.md
     ```
   - Your README should include:
     - Plugin description
     - Installation instructions
     - Configuration requirements
     - Usage examples
     - API documentation

4. **Publish Plugin**
   - Ensure your package.json includes:
     ```json
     {
       "name": "arok-plugin--your-plugin-name",
       "version": "1.0.0",
       "main": "dist/index.js",
       "types": "dist/index.d.ts",
       "files": ["dist"],
       "peerDependencies": {
         "arok-mini": "^1.0.0"
       }
     }
     ```
   - Publish to npm: `npm publish`

### Using Plugins

Import and register plugins in your application:

```typescript
import { YourPlugin } from "arok-plugin--your-plugin-name";

// In your initialization code
const agent = new AgentService({
  openaiApiKey: process.env.OPENAI_API_KEY as string
});

// Register the plugin
await agent.registerPlugin(new YourPlugin());
```

### Plugin Requirements

- Must implement the Plugin interface
- Published as a separate npm package with name format `arok-plugin--*`
- Include comprehensive documentation
- Include test coverage
- Follow existing code style (use prettier)
- Use semantic versioning
- List arok-mini as a peer dependency

## Running Locally

### Prerequisites

- Node.js 18+
- Firebase account (for storage)
- Twitter API credentials (if using Twitter features)
- OpenAI API key

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/arok-mini.git
   cd arok-mini
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**
   Copy `.env.example` to `.env` and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:8080` by default.

### Development Commands

- `npm run dev`: Start development server with hot reload
- `npm run serve`: Start server without hot reload
- `npm start`: Start production server
- `:dev`: Start with Bun runtime (experimental)

### Testing API Endpoints

Test the chat endpoint:

```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello AROK"}'
```

## Environment Variables

Required environment variables:

```
# CORE
FIREBASE_CONFIG="{"apiKey":...}"

HELICONE_API_KEY
TOGETHER_API_KEY
OPENAI_API_KEY

# PLUGINs

PLUGIN_QUERY_API_URL
PLUGIN_API_TOKEN

# TWITTER
PLUGIN_TWITTER_USERNAME
PLUGIN_TWITTER_PASSWORD
PLUGIN_TWITTER_EMAIL
```

## Coding with Claude

AROK Mini includes a helpful development workflow for getting assistance from Claude. This workflow allows you to easily share your codebase with Claude and get contextual help.

### Using the Concatenation Script

The repository includes a `concat_files.sh` script that prepares your codebase for sharing with Claude:

```bash
./concat_files.sh
```

This script:

1. Creates a timestamped folder in `./projects/`
2. Concatenates all relevant source files
3. Excludes node_modules and other unnecessary files
4. Creates a single text file with the full codebase context

### Getting Help from Claude

1. Run the concatenation script

```bash
./concat_files.sh
```

2. Find the latest file in `./projects/`

```bash
ls -lt ./projects/
```

3. Copy the contents of the newest file

4. Paste the contents to Claude using the following format:

```
<documents>
<document>
<source>paste.txt</source>
<document_content>
[Paste the concatenated file contents here]
</document_content>
</document>
</documents>

[Ask your development question here]
```

This gives Claude full context of your codebase to provide more accurate and contextual assistance.

### Best Practices

- Run the script before asking new questions to ensure Claude has the latest code context
- Be specific in your questions and reference specific files or features
- Include any error messages or specific behaviors you're trying to achieve
- Let Claude know if you've made significant changes to the code since the last concatenation

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please make sure to update tests as appropriate and adhere to the existing coding style.

## License

This project is licensed under the ISC License - see the LICENSE file for details.
