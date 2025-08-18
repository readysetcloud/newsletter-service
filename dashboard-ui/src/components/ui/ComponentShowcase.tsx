import React, { useState } from 'react';
import {
  Button,
  Input,
  TextArea,
  Select,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalContent,
  ModalFooter,
  Loading,
  LoadingSkeleton,
  Layout,
  Navigation,
  NavigationItem,
  useToast
} from './index';

const ComponentShowcase: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
    category: ''
  });
  const { addToast } = useToast();

  const selectOptions = [
    { value: 'general', label: 'General Inquiry' },
    { value: 'support', label: 'Support' },
    { value: 'billing', label: 'Billing' },
    { value: 'feature', label: 'Feature Request' }
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addToast({
      type: 'success',
      title: 'Form Submitted',
      message: 'Your information has been saved successfully.'
    });
  };

  const showErrorToast = () => {
    addToast({
      type: 'error',
      title: 'Error Occurred',
      message: 'Something went wrong. Please try again.'
    });
  };

  const showWarningToast = () => {
    addToast({
      type: 'warning',
      title: 'Warning',
      message: 'Please review your input before proceeding.'
    });
  };

  const showInfoToast = () => {
    addToast({
      type: 'info',
      title: 'Information',
      message: 'This is an informational message.',
      action: {
        label: 'Learn More',
        onClick: () => console.log('Learn more clicked')
      }
    });
  };

  const header = (
    <>
      <div className="flex items-center">
        <h1 className="text-xl font-semibold text-slate-900">
          Newsletter Admin
        </h1>
      </div>
      <div className="flex items-center space-x-4">
        <Button variant="outline" size="sm">
          Settings
        </Button>
        <Button size="sm">
          Profile
        </Button>
      </div>
    </>
  );

  const sidebar = (
    <Navigation>
      <NavigationItem active icon={
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
        </svg>
      }>
        Dashboard
      </NavigationItem>
      <NavigationItem icon={
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      }>
        Brand
      </NavigationItem>
      <NavigationItem icon={
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
      }>
        API Keys
      </NavigationItem>
      <NavigationItem icon={
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      }>
        Profile
      </NavigationItem>
    </Navigation>
  );

  return (
    <Layout header={header} sidebar={sidebar}>
      <div className="space-y-8">
        {/* Form Components Section */}
        <Card>
          <CardHeader>
            <CardTitle>Form Components</CardTitle>
            <CardDescription>
              Demonstration of form inputs with validation styling
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Full Name"
                  placeholder="Enter your name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  leftIcon={
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  }
                />
                <Input
                  label="Email Address"
                  type="email"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  error={formData.email && !formData.email.includes('@') ? 'Please enter a valid email' : undefined}
                />
              </div>

              <Select
                label="Category"
                options={selectOptions}
                placeholder="Select a category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              />

              <TextArea
                label="Message"
                placeholder="Enter your message"
                rows={4}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                helperText="Please provide as much detail as possible"
              />
            </form>
          </CardContent>
          <CardFooter>
            <div className="flex space-x-2">
              <Button type="submit" onClick={handleSubmit}>
                Submit Form
              </Button>
              <Button variant="outline" onClick={() => setIsModalOpen(true)}>
                Open Modal
              </Button>
            </div>
          </CardFooter>
        </Card>

        {/* Button Variants Section */}
        <Card>
          <CardHeader>
            <CardTitle>Button Variants</CardTitle>
            <CardDescription>
              Different button styles and states
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button isLoading>Loading</Button>
              <Button disabled>Disabled</Button>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </div>
          </CardContent>
        </Card>

        {/* Toast Notifications Section */}
        <Card>
          <CardHeader>
            <CardTitle>Toast Notifications</CardTitle>
            <CardDescription>
              Different types of toast notifications
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => addToast({ type: 'success', title: 'Success!', message: 'Operation completed successfully.' })}>
                Success Toast
              </Button>
              <Button variant="outline" onClick={showErrorToast}>
                Error Toast
              </Button>
              <Button variant="outline" onClick={showWarningToast}>
                Warning Toast
              </Button>
              <Button variant="outline" onClick={showInfoToast}>
                Info Toast
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Loading States Section */}
        <Card>
          <CardHeader>
            <CardTitle>Loading States</CardTitle>
            <CardDescription>
              Different loading indicators and skeleton screens
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <h4 className="text-sm font-medium mb-2">Spinner</h4>
                <Loading variant="spinner" size="lg" />
              </div>
              <div className="text-center">
                <h4 className="text-sm font-medium mb-2">Dots</h4>
                <Loading variant="dots" size="lg" />
              </div>
              <div className="text-center">
                <h4 className="text-sm font-medium mb-2">Pulse</h4>
                <Loading variant="pulse" size="lg" />
              </div>
            </div>
            <div className="mt-6">
              <h4 className="text-sm font-medium mb-2">Loading Skeleton</h4>
              <LoadingSkeleton lines={3} avatar />
            </div>
          </CardContent>
        </Card>

        {/* Modal */}
        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
          <ModalHeader onClose={() => setIsModalOpen(false)}>
            <ModalTitle>Example Modal</ModalTitle>
          </ModalHeader>
          <ModalContent>
            <p className="text-slate-600">
              This is an example modal dialog. It can contain any content you need,
              including forms, images, or other components.
            </p>
            <div className="mt-4">
              <Input label="Modal Input" placeholder="Type something..." />
            </div>
          </ModalContent>
          <ModalFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setIsModalOpen(false)}>
              Confirm
            </Button>
          </ModalFooter>
        </Modal>
      </div>
    </Layout>
  );
};

export default ComponentShowcase;
