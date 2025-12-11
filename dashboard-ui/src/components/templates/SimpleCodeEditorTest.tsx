import React, { useState } from 'react';
import { SimpleCodeEditor } from './SimpleCodeEditor';

const TEST_DATA = `{
  "newsletter": {
    "title": "Weekly Newsletter",
    "issue": 42
  },
  "subscriber": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}`;

export const SimpleCodeEditorTest: React.FC = () => {
  const [code, setCode] = useState('');

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-4">SimpleCodeEditor Test</h2>
      <p className="text-sm text-gray-600 mb-4">
        Test the variable intellisense by:
        <br />• Typing {`{{`} (should show tooltip)
        <br />• Pressing Ctrl+Space
        <br />• Clicking the Variables button
      </p>

      <SimpleCodeEditor
        value={code}
        onChange={setCode}
        language="handlebars"
        height="300px"
        testData={TEST_DATA}
        placeholder="Type {{ to test variable intellisense..."
        theme="light"
      />

      <div className="mt-4 p-3 bg-gray-100 rounded">
        <h3 className="font-medium mb-2">Current Code:</h3>
        <pre className="text-sm">{code || 'No code entered yet'}</pre>
      </div>
    </div>
  );
};
