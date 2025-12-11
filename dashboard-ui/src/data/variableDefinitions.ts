import {
  VariableDefinitions,
  VariableCategory,
  Variable,
  ControlFlowHelper
} from '../types/variable';

// Predefined Variables by Category
const NEWSLETTER_VARIABLES: Variable[] = [
  {
    id: 'newsletter-title',
    name: 'Newsletter Title',
    path: 'newsletter.title',
    category: VariableCategory.NEWSLETTER,
    type: 'string',
    sampleValue: 'Serverless Picks of the Week #42',
    description: 'The title of the current newsletter issue',
    isCustom: false
  },
  {
    id: 'newsletter-issue',
    name: 'Issue Number',
    path: 'newsletter.issue',
    category: VariableCategory.NEWSLETTER,
    type: 'number',
    sampleValue: 42,
    description: 'The current issue number',
    isCustom: false
  },
  {
    id: 'newsletter-date',
    name: 'Publication Date',
    path: 'newsletter.date',
    category: VariableCategory.NEWSLETTER,
    type: 'date',
    sampleValue: '2024-03-15',
    description: 'The date this newsletter was published',
    isCustom: false
  },
  {
    id: 'newsletter-description',
    name: 'Newsletter Description',
    path: 'newsletter.description',
    category: VariableCategory.NEWSLETTER,
    type: 'string',
    sampleValue: 'Your weekly dose of serverless insights and tools',
    description: 'Brief description of the newsletter content',
    isCustom: false
  },
  {
    id: 'newsletter-url',
    name: 'Newsletter URL',
    path: 'newsletter.url',
    category: VariableCategory.NEWSLETTER,
    type: 'url',
    sampleValue: 'https://readysetcloud.io/newsletter/42',
    description: 'URL to view this newsletter online',
    isCustom: false
  },
  {
    id: 'newsletter-has-sponsors',
    name: 'Has Sponsors',
    path: 'newsletter.hasSponsors',
    category: VariableCategory.NEWSLETTER,
    type: 'boolean',
    sampleValue: true,
    description: 'Whether this newsletter includesr content',
    isCustom: false
  },
  {
    id: 'newsletter-is-draft',
    name: 'Is Draft',
    path: 'newsletter.isDraft',
    category: VariableCategory.NEWSLETTER,
    type: 'boolean',
    sampleValue: false,
    description: 'Whether this newsletter is still in draft mode',
    isCustom: false
  },
  {
    id: 'newsletter-featured-article',
    name: 'Featured Article',
    path: 'newsletter.featuredArticle',
    category: VariableCategory.NEWSLETTER,
    type: 'object',
    sampleValue: {
      title: 'Building Serverless APIs with AWS Lambda',
      description: 'Learn how to create scalable serverless APIs',
      url: 'https://example.com/article',
      image: 'https://example.com/image.jpg'
    },
    description: 'The featured article for this newsletter',
    isCustom: false
  },
  {
    id: 'newsletter-articles',
    name: 'Articles List',
    path: 'newsletter.articles',
    category: VariableCategory.NEWSLETTER,
    type: 'array',
    sampleValue: [
      {
        title: 'AWS Lambda Best Practices',
        summary: 'Essential tips for Lambda development',
        url: 'https://example.com/lambda-tips',
        author: 'John Doe'
      },
      {
        title: 'Serverless Monitoring Guide',
        summary: 'How to monitor your serverless applications',
        url: 'https://example.com/monitoring',
        author: 'Jane Smith'
      }
    ],
    description: 'List of articles in this newsletter',
    isCustom: false
  },
  {
    id: 'newsletter-sponsors',
    name: 'Sponsors List',
    path: 'newsletter.sponsors',
    category: VariableCategory.NEWSLETTER,
    type: 'array',
    sampleValue: [
      {
        name: 'AWS',
        logo: 'https://example.com/aws-logo.png',
        url: 'https://aws.amazon.com'
      }
    ],
    description: 'List of sponsors for this newsletter',
    isCustom: false
  },
  {
    id: 'newsletter-tags',
    name: 'Tags',
    path: 'newsletter.tags',
    category: VariableCategory.NEWSLETTER,
    type: 'array',
    sampleValue: ['serverless', 'aws', 'lambda', 'api-gateway'],
    description: 'Tags associated with this newsletter',
    isCustom: false
  }
];

const SUBSCRIBER_VARIABLES: Variable[] = [
  {
    id: 'subscriber-first-name',
    name: 'First Name',
    path: 'subscriber.firstName',
    category: VariableCategory.SUBSCRIBER,
    type: 'string',
    sampleValue: 'John',
    description: 'Subscriber\'s first name',
    isCustom: false
  },
  {
    id: 'subscriber-last-name',
    name: 'Last Name',
    path: 'subscriber.lastName',
    category: VariableCategory.SUBSCRIBER,
    type: 'string',
    sampleValue: 'Doe',
    description: 'Subscriber\'s last name',
    isCustom: false
  },
  {
    id: 'subscriber-email',
    name: 'Email Address',
    path: 'subscriber.email',
    category: VariableCategory.SUBSCRIBER,
    type: 'string',
    sampleValue: 'john.doe@example.com',
    description: 'Subscriber\'s email address',
    isCustom: false
  },
  {
    id: 'subscriber-subscription-date',
    name: 'Subscription Date',
    path: 'subscriber.subscriptionDate',
    category: VariableCategory.SUBSCRIBER,
    type: 'date',
    sampleValue: '2024-01-15',
    description: 'Date when the subscriber joined',
    isCustom: false
  },
  {
    id: 'subscriber-is-premium',
    name: 'Is Premium Subscriber',
    path: 'subscriber.isPremium',
    category: VariableCategory.SUBSCRIBER,
    type: 'boolean',
    sampleValue: true,
    description: 'Whether the subscriber has a premium account',
    isCustom: false
  },
  {
    id: 'subscriber-has-unsubscribed',
    name: 'Has Unsubscribed',
    path: 'subscriber.hasUnsubscribed',
    category: VariableCategory.SUBSCRIBER,
    type: 'boolean',
    sampleValue: false,
    description: 'Whether the subscriber has unsubscribed',
    isCustom: false
  },
  {
    id: 'subscriber-preferences',
    name: 'Preferences',
    path: 'subscriber.preferences',
    category: VariableCategory.SUBSCRIBER,
    type: 'object',
    sampleValue: {
      frequency: 'weekly',
      topics: ['serverless', 'aws', 'devops']
    },
    description: 'Subscriber\'s preferences and settings',
    isCustom: false
  }
];

const BRAND_VARIABLES: Variable[] = [
  {
    id: 'brand-name',
    name: 'Brand Name',
    path: 'brand.name',
    category: VariableCategory.BRAND,
    type: 'string',
    sampleValue: 'Ready Set Cloud',
    description: 'Your brand or company name',
    isCustom: false
  },
  {
    id: 'brand-logo',
    name: 'Brand Logo',
    path: 'brand.logo',
    category: VariableCategory.BRAND,
    type: 'url',
    sampleValue: 'https://readysetcloud.s3.us-east-1.amazonaws.com/newsletter.png',
    description: 'URL to your brand logo image',
    isCustom: false
  },
  {
    id: 'brand-primary-color',
    name: 'Primary Color',
    path: 'brand.primaryColor',
    category: VariableCategory.BRAND,
    type: 'string',
    sampleValue: '#3B82F6',
    description: 'Your brand\'s primary color',
    isCustom: false
  },
  {
    id: 'brand-website',
    name: 'Website URL',
    path: 'brand.website',
    category: VariableCategory.BRAND,
    type: 'url',
    sampleValue: 'https://readysetcloud.io',
    description: 'Your main website URL',
    isCustom: false
  },
  {
    id: 'brand-show-logo',
    name: 'Show Logo',
    path: 'brand.showLogo',
    category: VariableCategory.BRAND,
    type: 'boolean',
    sampleValue: true,
    description: 'Whether to display the brand logo',
    isCustom: false
  },
  {
    id: 'brand-social-media',
    name: 'Social Media',
    path: 'brand.socialMedia',
    category: VariableCategory.BRAND,
    type: 'object',
    sampleValue: {
      twitter: 'https://twitter.com/readysetcloud',
      linkedin: 'https://linkedin.com/company/readysetcloud',
      github: 'https://github.com/readysetcloud'
    },
    description: 'Social media links and profiles',
    isCustom: false
  }
];

const SYSTEM_VARIABLES: Variable[] = [
  {
    id: 'system-unsubscribe-url',
    name: 'Unsubscribe URL',
    path: 'system.unsubscribeUrl',
    category: VariableCategory.SYSTEM,
    type: 'url',
    sampleValue: 'https://example.com/unsubscribe?token=abc123',
    description: 'URL for subscribers to unsubscribe',
    isCustom: false
  },
  {
    id: 'system-view-online-url',
    name: 'View Online URL',
    path: 'system.viewOnlineUrl',
    category: VariableCategory.SYSTEM,
    type: 'url',
    sampleValue: 'https://example.com/newsletter/42',
    description: 'URL to view the newsletter online',
    isCustom: false
  },
  {
    id: 'system-current-date',
    name: 'Current Date',
    path: 'system.currentDate',
    category: VariableCategory.SYSTEM,
    type: 'date',
    sampleValue: new Date().toISOString().split('T')[0],
    description: 'Current date when the newsletter is sent',
    isCustom: false
  }
];

// Built-in Control Flow Helpers
const BUILT_IN_CONTROL_FLOW: ControlFlowHelper[] = [
  {
    id: 'if',
    name: 'Conditional (if)',
    syntax: '{{#if condition}}',
    closingSyntax: '{{/if}}',
    description: 'Show content only when condition is true',
    category: 'conditional',
    parameters: [
      {
        name: 'condition',
        type: 'variable',
        required: true,
        description: 'Variable or expression to evaluate',
        examples: ['newsletter.hasSponsors', 'subscriber.isPremium', 'brand.showLogo']
      }
    ],
    examples: [
      {
        title: 'Show sponsor section',
        code: '{{#if newsletter.hasSponsors}}\n  <div>Sponsor content here</div>\n{{/if}}',
        description: 'Only display sponsor content when sponsors exist',
        variables: ['newsletter.hasSponsors']
      },
      {
        title: 'Premium subscriber content',
        code: '{{#if subscriber.isPremium}}\n  <div>Exclusive premium content</div>\n{{/if}}',
        description: 'Show special content for premium subscribers',
        variables: ['subscriber.isPremium']
      }
    ]
  },
  {
    id: 'unless',
    name: 'Conditional (unless)',
    syntax: '{{#unless condition}}',
    closingSyntax: '{{/unless}}',
    description: 'Show content only when condition is false',
    category: 'conditional',
    parameters: [
      {
        name: 'condition',
        type: 'variable',
        required: true,
        description: 'Variable or expression to evaluate',
        examples: ['newsletter.isDraft', 'subscriber.hasUnsubscribed']
      }
    ],
    examples: [
      {
        title: 'Hide for unsubscribed users',
        code: '{{#unless subscriber.hasUnsubscribed}}\n  <div>Newsletter content</div>\n{{/unless}}',
        description: 'Only show content to active subscribers',
        variables: ['subscriber.hasUnsubscribed']
      }
    ]
  },
  {
    id: 'each',
    name: 'Loop (each)',
    syntax: '{{#each items}}',
    closingSyntax: '{{/each}}',
    description: 'Repeat content for each item in an array',
    category: 'iterator',
    parameters: [
      {
        name: 'items',
        type: 'variable',
        required: true,
        description: 'Array variable to iterate over',
        examples: ['newsletter.articles', 'newsletter.sponsors', 'newsletter.tags']
      }
    ],
    examples: [
      {
        title: 'List all articles',
        code: '{{#each newsletter.articles}}\n  <h3>{{this.title}}</h3>\n  <p>{{this.summary}}</p>\n{{/each}}',
        description: 'Display each article with title and summary',
        variables: ['newsletter.articles']
      },
      {
        title: 'Display sponsors',
        code: '{{#each newsletter.sponsors}}\n  <img src="{{this.logo}}" alt="{{this.name}}">\n  <a href="{{this.url}}">{{this.name}}</a>\n{{/each}}',
        description: 'Show all newsletter sponsors',
        variables: ['newsletter.sponsors']
      }
    ]
  },
  {
    id: 'with',
    name: 'Context (with)',
    syntax: '{{#with object}}',
    closingSyntax: '{{/with}}',
    description: 'Change context to work with nested object properties',
    category: 'custom',
    parameters: [
      {
        name: 'object',
        type: 'variable',
        required: true,
        description: 'Object to use as new context',
        examples: ['newsletter.featuredArticle', 'brand.socialMedia', 'subscriber.preferences']
      }
    ],
    examples: [
      {
        title: 'Featured article section',
        code: '{{#with newsletter.featuredArticle}}\n  <h2>{{title}}</h2>\n  <p>{{description}}</p>\n  <a href="{{url}}">Read more</a>\n{{/with}}',
        description: 'Access featured article properties directly',
        variables: ['newsletter.featuredArticle']
      },
      {
        title: 'Social media links',
        code: '{{#with brand.socialMedia}}\n  <a href="{{twitter}}">Twitter</a>\n  <a href="{{linkedin}}">LinkedIn</a>\n  <a href="{{github}}">GitHub</a>\n{{/with}}',
        description: 'Display social media links using context',
        variables: ['brand.socialMedia']
      }
    ]
  }
];

// Contextual mappings for different component types
const CONTEXTUAL_MAPPINGS = {
  heading: {
    priority: [
      'newsletter.title',
      'newsletter.featuredArticle.title',
      'brand.name',
      'subscriber.firstName'
    ],
    excluded: ['system.unsubscribeUrl', 'system.viewOnlineUrl']
  },
  text: {
    priority: [
      'newsletter.description',
      'newsletter.featuredArticle.description',
      'subscriber.firstName',
      'subscriber.lastName'
    ],
    excluded: []
  },
  button: {
    priority: [
      'newsletter.url',
      'newsletter.featuredArticle.url',
      'brand.website',
      'system.viewOnlineUrl',
      'system.unsubscribeUrl'
    ],
    excluded: ['newsletter.isDraft', 'subscriber.hasUnsubscribed']
  },
  image: {
    priority: [
      'brand.logo',
      'newsletter.featuredArticle.image',
      'newsletter.sponsors'
    ],
    excluded: ['subscriber.email', 'system.unsubscribeUrl']
  },
  link: {
    priority: [
      'newsletter.url',
      'newsletter.featuredArticle.url',
      'brand.website',
      'brand.socialMedia',
      'system.viewOnlineUrl'
    ],
    excluded: ['newsletter.isDraft']
  },
  divider: {
    priority: [],
    excluded: ['newsletter.articles', 'newsletter.sponsors', 'subscriber.preferences']
  },
  spacer: {
    priority: [],
    excluded: ['newsletter.articles', 'newsletter.sponsors', 'subscriber.preferences']
  }
};

// Main variable definitions export
export const VARIABLE_DEFINITIONS: VariableDefinitions = {
  categories: {
    [VariableCategory.NEWSLETTER]: {
      label: 'Newsletter',
      description: 'Variables related to the current newsletter content',
      variables: NEWSLETTER_VARIABLES
    },
    [VariableCategory.SUBSCRIBER]: {
      label: 'Subscriber',
      description: 'Variables related to the newsletter subscriber',
      variables: SUBSCRIBER_VARIABLES
    },
    [VariableCategory.BRAND]: {
      label: 'Brand',
      description: 'Variables related to your brand and company',
      variables: BRAND_VARIABLES
    },
    [VariableCategory.SYSTEM]: {
      label: 'System',
      description: 'System-generated variables and URLs',
      variables: SYSTEM_VARIABLES
    },
    [VariableCategory.CUSTOM]: {
      label: 'Custom',
      description: 'Custom variables you have created',
      variables: [] // Will be populated with user-created variables
    },
    [VariableCategory.CONTROL_FLOW]: {
      label: 'Control Flow',
      description: 'Conditional logic and loops for dynamic content',
      variables: [] // Control flow helpers are separate
    }
  },
  contextualMappings: CONTEXTUAL_MAPPINGS,
  controlFlowHelpers: BUILT_IN_CONTROL_FLOW
};

// Helper functions to work with variable definitions
export const getVariablesByCategory = (category: VariableCategory): Variable[] => {
  return VARIABLE_DEFINITIONS.categories[category]?.variables || [];
};

export const getAllVariables = (): Variable[] => {
  const allVariables: Variable[] = [];
  for (const category of Object.values(VARIABLE_DEFINITIONS.categories)) {
    allVariables.push(...category.variables);
  }
  return allVariables;
};

export const getVariableById = (id: string): Variable | undefined => {
  for (const category of Object.values(VARIABLE_DEFINITIONS.categories)) {
    const variable = category.variables.find(v => v.id === id);
    if (variable) return variable;
  }
  return undefined;
};

export const getVariableByPath = (path: string): Variable | undefined => {
  for (const category of Object.values(VARIABLE_DEFINITIONS.categories)) {
    const variable = category.variables.find(v => v.path === path);
    if (variable) return variable;
  }
  return undefined;
};

export const getControlFlowHelperById = (id: string): ControlFlowHelper | undefined => {
  return VARIABLE_DEFINITIONS.controlFlowHelpers.find(h => h.id === id);
};

export const getContextualVariables = (componentType: string): {
  priority: Variable[];
  excluded: string[];
} => {
  const mapping = VARIABLE_DEFINITIONS.contextualMappings[componentType];
  if (!mapping) {
    return { priority: [], excluded: [] };
  }

  const priorityVariables = mapping.priority
    .map(path => getVariableByPath(path))
    .filter((v): v is Variable => v !== undefined);

  return {
    priority: priorityVariables,
    excluded: mapping.excluded
  };
};

export const searchVariables = (query: string, contextType?: string): Variable[] => {
  const allVariables: Variable[] = [];

  // Collect all variables from all categories except control flow
  Object.entries(VARIABLE_DEFINITIONS.categories).forEach(([category, categoryData]) => {
    if (category !== VariableCategory.CONTROL_FLOW) {
      allVariables.push(...categoryData.variables);
    }
  });

  // Filter by search query
  const filteredVariables = allVariables.filter(variable =>
    variable.name.toLowerCase().includes(query.toLowerCase()) ||
    variable.path.toLowerCase().includes(query.toLowerCase()) ||
    variable.description?.toLowerCase().includes(query.toLowerCase())
  );

  // Apply contextual filtering if component type is provided
  if (contextType) {
    const contextual = getContextualVariables(contextType);
    const excludedPaths = new Set(contextual.excluded);

    return filteredVariables
      .filter(variable => !excludedPaths.has(variable.path))
      .sort((a, b) => {
        // Prioritize contextually relevant variables
        const aIndex = contextual.priority.findIndex(v => v.id === a.id);
        const bIndex = contextual.priority.findIndex(v => v.id === b.id);

        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
  }

  return filteredVariables.sort((a, b) => a.name.localeCompare(b.name));
};
