import { SampleDataSet } from '../types/variable';

// Sample data for variable previews and testing
export const SAMPLE_DATA: SampleDataSet = {
  newsletter: {
    title: 'Serverless Picks of the Week #42',
    issue: 42,
    date: '2024-03-15',
    description: 'Your weekly dosless insights, tools, and best practices',
    url: 'https://readysetcloud.io/newsletter/42',
    hasSponsors: true,
    isDraft: false,
    articles: [
      {
        title: 'AWS Lambda Best Practices for Production',
        summary: 'Essential tips and tricks for running Lambda functions in production environments, including error handling, monitoring, and performance optimization.',
        url: 'https://readysetcloud.io/articles/lambda-best-practices',
        author: 'Allen Helton'
      },
      {
        title: 'Serverless Monitoring with CloudWatch and X-Ray',
        summary: 'Learn how to effectively monitor your serverless applications using AWS CloudWatch metrics, logs, and X-Ray distributed tracing.',
        url: 'https://readysetcloud.io/articles/serverless-monitoring',
        author: 'Sarah Johnson'
      },
      {
        title: 'Building Event-Driven Architectures with EventBridge',
        summary: 'Discover how to create scalable, decoupled systems using Amazon EventBridge for event routing and processing.',
        url: 'https://readysetcloud.io/articles/eventbridge-architecture',
        author: 'Mike Chen'
      },
      {
        title: 'Cost Optimization Strategies for Serverless Applications',
        summary: 'Practical approaches to reduce costs in your serverless applications without sacrificing performance or reliability.',
        url: 'https://readysetcloud.io/articles/serverless-cost-optimization',
        author: 'Lisa Rodriguez'
      }
    ],
    sponsors: [
      {
        name: 'AWS',
        logo: 'https://readysetcloud.s3.us-east-1.amazonaws.com/sponsors/aws-logo.png',
        url: 'https://aws.amazon.com'
      },
      {
        name: 'Momento',
        logo: 'https://readysetcloud.s3.us-east-1.amazonaws.com/sponsors/momento-logo.png',
        url: 'https://gomomento.com'
      }
    ],
    featuredArticle: {
      title: 'Building Serverless APIs with AWS Lambda and API Gateway',
      description: 'A comprehensive guide to creating scalable, secure serverless APIs using AWS Lambda and API Gateway. Learn about authentication, validation, error handling, and deployment best practices.',
      url: 'https://readysetcloud.io/articles/serverless-api-guide',
      image: 'https://readysetcloud.s3.us-east-1.amazonaws.com/articles/serverless-api-hero.jpg'
    },
    tags: ['serverless', 'aws', 'lambda', 'api-gateway', 'eventbridge', 'monitoring', 'cost-optimization']
  },
  subscriber: {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    subscriptionDate: '2024-01-15',
    isPremium: true,
    hasUnsubscribed: false,
    preferences: {
      frequency: 'weekly',
      topics: ['serverless', 'aws', 'devops', 'architecture']
    }
  },
  brand: {
    name: 'Ready Set Cloud',
    logo: 'https://readysetcloud.s3.us-east-1.amazonaws.com/newsletter.png',
    primaryColor: '#3B82F6',
    website: 'https://readysetcloud.io',
    showLogo: true,
    socialMedia: {
      twitter: 'https://twitter.com/readysetcloud',
      linkedin: 'https://linkedin.com/company/readysetcloud',
      github: 'https://github.com/readysetcloud'
    }
  },
  custom: {
    // This will be populated with user-defined custom variables
    // Examples of what might be here:
    companyName: 'Acme Corp',
    supportEmail: 'support@acme.com',
    productName: 'CloudMaster Pro',
    currentPromotion: '20% off annual plans',
    nextWebinarDate: '2024-03-22',
    featuredTool: 'AWS CDK'
  }
};

// Alternative sample data sets for testing different scenarios
export const SAMPLE_DATA_SETS = {
  default: SAMPLE_DATA,

  // Sample data for a newsletter without sponsors
  noSponsors: {
    ...SAMPLE_DATA,
    newsletter: {
      ...SAMPLE_DATA.newsletter,
      hasSponsors: false,
      sponsors: []
    }
  },

  // Sample data for a draft newsletter
  draft: {
    ...SAMPLE_DATA,
    newsletter: {
      ...SAMPLE_DATA.newsletter,
      isDraft: true,
      title: 'Draft: Serverless Picks of the Week #43'
    }
  },

  // Sample data for a non-premium subscriber
  freeTier: {
    ...SAMPLE_DATA,
    subscriber: {
      ...SAMPLE_DATA.subscriber,
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane.smith@example.com',
      isPremium: false,
      preferences: {
        frequency: 'weekly',
        topics: ['serverless', 'aws']
      }
    }
  },

  // Sample data for a brand without social media
  minimalBrand: {
    ...SAMPLE_DATA,
    brand: {
      ...SAMPLE_DATA.brand,
      name: 'Tech Weekly',
      showLogo: false,
      socialMedia: {
        twitter: '',
        linkedin: '',
        github: ''
      }
    }
  },

  // Sample data with minimal content
  minimal: {
    newsletter: {
      title: 'Weekly Update #1',
      issue: 1,
      date: '2024-03-15',
      description: 'Our first newsletter',
      url: 'https://example.com/newsletter/1',
      hasSponsors: false,
      isDraft: false,
      articles: [
        {
          title: 'Getting Started',
          summary: 'Welcome to our newsletter',
          url: 'https://example.com/getting-started',
          author: 'Editor'
        }
      ],
      sponsors: [],
      featuredArticle: {
        title: 'Welcome',
        description: 'Welcome to our newsletter',
        url: 'https://example.com/welcome',
        image: 'https://example.com/welcome.jpg'
      },
      tags: ['newsletter', 'welcome']
    },
    subscriber: {
      firstName: 'New',
      lastName: 'Subscriber',
      email: 'new@example.com',
      subscriptionDate: '2024-03-15',
      isPremium: false,
      hasUnsubscribed: false,
      preferences: {
        frequency: 'weekly',
        topics: ['general']
      }
    },
    brand: {
      name: 'Newsletter',
      logo: 'https://example.com/logo.png',
      primaryColor: '#000000',
      website: 'https://example.com',
      showLogo: true,
      socialMedia: {
        twitter: '',
        linkedin: '',
        github: ''
      }
    },
    custom: {}
  }
};

// Helper functions for working with sample data
export const getSampleDataSet = (name: keyof typeof SAMPLE_DATA_SETS = 'default'): SampleDataSet => {
  return SAMPLE_DATA_SETS[name] || SAMPLE_DATA_SETS.default;
};

export const getSampleValueForPath = (path: string, dataSet: SampleDataSet = SAMPLE_DATA): any => {
  const pathParts = path.split('.');
  let current: any = dataSet;

  for (const part of pathParts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
};

export const formatSampleValue = (value: any, maxLength: number = 50): string => {
  if (value === null || value === undefined) {
    return 'N/A';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    return value.toString();
  }

  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.substring(0, maxLength)}...` : value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.length === 1) return `[${formatSampleValue(value[0], maxLength - 2)}]`;
    return `[${formatSampleValue(value[0], maxLength - 10)}, +${value.length - 1} more]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    if (keys.length === 1) {
      const key = keys[0];
      return `{${key}: ${formatSampleValue(value[key], maxLength - key.length - 4)}}`;
    }
    return `{${keys[0]}: ..., +${keys.length - 1} more}`;
  }

  return String(value);
};

// Generate preview text for variables in different contexts
export const generateVariablePreview = (
  path: string,
  contextType?: string,
  dataSet: SampleDataSet = SAMPLE_DATA
): string => {
  const value = getSampleValueForPath(path, dataSet);

  if (value === undefined) {
    return `{{${path}}}`;
  }

  // Context-specific formatting
  switch (contextType) {
    case 'heading':
      if (typeof value === 'string') {
        return value;
      }
      break;

    case 'button':
      if (typeof value === 'string' && (value.startsWith('http') || value.includes('@'))) {
        return value;
      }
      if (typeof value === 'string') {
        return value.length > 20 ? `${value.substring(0, 20)}...` : value;
      }
      break;

    case 'image':
      if (typeof value === 'string' && value.startsWith('http')) {
        return value;
      }
      break;

    default:
      return formatSampleValue(value);
  }

  return formatSampleValue(value);
};

// Validate that sample data matches expected structure
export const validateSampleData = (data: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Check required top-level properties
  const requiredProps = ['newsletter', 'subscriber', 'brand', 'custom'];
  for (const prop of requiredProps) {
    if (!data[prop]) {
      errors.push(`Missing required property: ${prop}`);
    }
  }

  // Check newsletter structure
  if (data.newsletter) {
    const requiredNewsletterProps = ['title', 'issue', 'date', 'description', 'url', 'hasSponsors', 'isDraft', 'articles', 'sponsors', 'featuredArticle', 'tags'];
    for (const prop of requiredNewsletterProps) {
      if (data.newsletter[prop] === undefined) {
        errors.push(`Missing newsletter property: ${prop}`);
      }
    }

    if (data.newsletter.articles && !Array.isArray(data.newsletter.articles)) {
      errors.push('newsletter.articles must be an array');
    }

    if (data.newsletter.sponsors && !Array.isArray(data.newsletter.sponsors)) {
      errors.push('newsletter.sponsors must be an array');
    }
  }

  // Check subscriber structure
  if (data.subscriber) {
    const requiredSubscriberProps = ['firstName', 'lastName', 'email', 'subscriptionDate', 'isPremium', 'hasUnsubscribed', 'preferences'];
    for (const prop of requiredSubscriberProps) {
      if (data.subscriber[prop] === undefined) {
        errors.push(`Missing subscriber property: ${prop}`);
      }
    }
  }

  // Check brand structure
  if (data.brand) {
    const requiredBrandProps = ['name', 'logo', 'primaryColor', 'website', 'showLogo', 'socialMedia'];
    for (const prop of requiredBrandProps) {
      if (data.brand[prop] === undefined) {
        errors.push(`Missing brand property: ${prop}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};
