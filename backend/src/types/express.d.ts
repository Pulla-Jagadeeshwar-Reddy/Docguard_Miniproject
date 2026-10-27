declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        fullName: string;
        email: string;
        roleId: number;
        role: string;
        departmentId: number | null;
        permissions: string[];
      };
    }
  }
}

export {};
